enum BankStateEnum {
    Idle, Refreshing, Activating, Active, Precharging
}

enum MemCommandEnum {
    REF, ACT, PRE, READ,WRITE
}

class MemCommand {
    public Command: MemCommandEnum;
    public BankNum: number;
    public Address: number;
    public AutoPrecharge: boolean;
    public NotLatched: number;

    get BankGroup(): number {
        return this.BankNum >> 2;
    }

    get Bank(): number {
        return this.BankNum & 3;
    }

    public constructor(cmd: MemCommandEnum, bank: number, addr: number) {
        this.Command = cmd;
        this.BankNum = bank;
        this.Address = addr;
        this.AutoPrecharge = false;
    }
}

class MemoryController {
    private static readonly BANKS = 16;

    private readonly tCL: number;
    private readonly tCWL: number;
    private readonly tRCD: number;
    private readonly tRP: number;
    private readonly tRAS: number;
    private readonly tRC: number;
    private readonly tRRDs: number;
    private readonly tRRDl: number;
    private readonly tFAW: number;
    private readonly tWTRs: number;
    private readonly tWTRl: number;
    private readonly tWR: number;
    private readonly tRTP: number;
    private readonly tCCDl: number;
    private readonly tCCDs: number;
    private readonly tREFI: number;
    private readonly tRFC: number;
    private readonly tRPRE: number;
    private readonly tWPRE: number;
    private readonly tCR: number;
    private readonly gearDown: boolean;
    private readonly x16Mode: boolean;

    private readonly bankState: BankState[];
    private readonly bankHistory: CommandHistory[];
    private readonly groupHistory: CommandHistory[];
    private readonly rankHistory: CommandHistory;
    private readonly imcCommandQueue: ImcCommand[];
    private readonly dqsSchedule: DqsSchedule[];
    private readonly bankCommandQueue: CommandQueue[];
    private readonly fawTracking: number[];

    private currentCycle: number;
    private sinceRefresh: number;
    private currentCommand: MemCommand;
    private dqsActive: boolean;
    private dqActive: [MemCommandEnum, number, number, number, number];
    public UseAutoPrecharge: boolean;

    get CurrentCycle(): number { return this.currentCycle; }
    get CurrentCommand(): MemCommand { return this.currentCommand; }
    get DqsActive(): boolean { return this.dqsActive; }
    get DqActive(): [MemCommandEnum, number, number, number, number] { return this.dqActive; }
    get DqAddress(): number {
        if(!this.dqActive) return null;
        let addr = this.dqActive[4];
        addr |= this.dqActive[3] << 10;
        addr |= this.dqActive[2] << 12;
        addr |= this.dqActive[1] << (this.x16Mode ? 13 : 14);
        return addr;
    }

    public constructor(tCL: number, tCWL: number, tRCD: number, tRP: number, tRAS: number, tRC: number,
                       tRRDs: number, tRRDl: number, tFAW: number, tWTRs: number, tWTRl: number,
                       tWR: number, tRTP: number, tCCDl: number, tCCDs: number,
                       tREFI: number, tRFC: number, tCR: number, gdm: boolean, x16: boolean) {
        this.tCL = tCL;
        this.tCWL = tCWL;
        this.tRCD = tRCD;
        this.tRP = tRP;
        this.tRAS = tRAS;
        this.tRC = tRC;
        this.tRRDs = tRRDs;
        this.tRRDl = tRRDl;
        this.tFAW = tFAW;
        this.tWTRs = tWTRs;
        this.tWTRl = tWTRl;
        this.tWR = tWR;
        this.tRTP = tRTP;
        this.tCCDl = tCCDl;
        this.tCCDs = tCCDs;
        this.tREFI = tREFI;
        this.tRFC = tRFC;
        this.x16Mode = x16;
        this.tRPRE = 1;
        this.tWPRE = 1;
        this.tCR = tCR;
        this.gearDown = gdm;

        this.currentCycle = 0;
        this.currentCommand = null;
        this.sinceRefresh = 0;
        this.fawTracking = [];
        this.imcCommandQueue = [];
        this.dqsSchedule = [];
        this.rankHistory = new CommandHistory();

        this.groupHistory = [new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),];

        this.bankCommandQueue = [
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),];

        this.bankHistory = [
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),];

        this.bankState = [
            new BankState(),new BankState(),new BankState(),new BankState(),
            new BankState(),new BankState(),new BankState(),new BankState(),
            new BankState(),new BankState(),new BankState(),new BankState(),
            new BankState(),new BankState(),new BankState(),new BankState(),];
    }

    public EnqueueCommand(cmd: ImcCommand): void {
        this.imcCommandQueue.push(cmd);
    }

    private maybeEnqueueRefresh(): void {
        if (this.bankCommandQueue.every(q => q.Empty)) {
            const preCommand = new MemCommand(MemCommandEnum.PRE, 0, 0);
            preCommand.AutoPrecharge = true;
            const refreshCommand = new MemCommand(MemCommandEnum.REF, 0, 0);

            if (!this.bankCommandQueue.every(q => q.OpenRow === null)) {
                this.bankCommandQueue.forEach(q => q.QueueCommand(preCommand));
            }

            this.bankCommandQueue.forEach(q => q.QueueCommand(refreshCommand));
        }
    }

    private scheduleDqs(cmd: MemCommand, dryRun: boolean): boolean {
        const delay = ((cmd.Command === MemCommandEnum.READ) ? this.tCL : this.tCWL) + this.tCR - 1;
        let prevDqs: DqsSchedule = this.dqsSchedule.length ? this.dqsSchedule[this.dqsSchedule.length - 1] : null;
        let nextDqs: DqsSchedule = null;
        let i: number;
        for (i = 0; i < this.dqsSchedule.length; i++) {
            if (delay < this.dqsSchedule[i].DueCycles) {
                nextDqs = this.dqsSchedule[i];
                if (i > 0) {
                    prevDqs = this.dqsSchedule[i - 1];
                    break;
                }
            }
        }

        let needsPreGap = false;
        let needsPreamble = false;
        let nextNeedsPreGap = false;
        let nextNeedsPreamble = false;

        let totalCycles = 4;
        let preamble = (cmd.Command === MemCommandEnum.READ) ? this.tRPRE : this.tWPRE;
        let nextPreamble = (nextDqs && (nextDqs.Command.Command === MemCommandEnum.READ)) ? this.tRPRE : this.tWPRE;

        let nextDqsDue = nextDqs ? nextDqs.DueCycles : delay + 4 + 1 + nextPreamble;
        let prevDqsEnd = prevDqs ? prevDqs.DueCycles + 4 : delay - 1 - preamble;

        needsPreGap ||= prevDqs && prevDqs.Command.Command !== cmd.Command;
        needsPreamble ||= prevDqsEnd !== delay;
        needsPreamble ||= needsPreGap;

        nextNeedsPreGap ||= nextDqs && nextDqs.Command.Command !== cmd.Command;
        nextNeedsPreamble ||= nextDqsDue - 4 !== delay;
        nextNeedsPreamble ||= nextNeedsPreGap;

        if (needsPreGap) totalCycles++;
        if (needsPreamble) totalCycles += preamble;
        if (nextNeedsPreGap) totalCycles++;
        if (nextNeedsPreamble) totalCycles += nextPreamble;

        if ((nextDqsDue - prevDqsEnd) < totalCycles)
            return false;

        if (dryRun)
            return true;

        if (nextDqs)
            nextDqs.Preamble = nextNeedsPreamble ? nextPreamble : 0;

        this.dqsSchedule.splice(i, 0,
            new DqsSchedule(delay, this.bankState[cmd.BankNum].CurrentOpenRow, cmd, needsPreamble ? preamble : 0));

        return true;
    }

    private issuePrechargeAllBanks() {
        const preA = new MemCommand(MemCommandEnum.PRE, 0, 0);
        preA.AutoPrecharge = true;
        this.issueCommand(preA);
    }

    private issueRefresh() {
        this.issueCommand(new MemCommand(MemCommandEnum.REF, 0, 0));
    }

    private issueCommand(cmd: MemCommand) {
        const bankState = this.bankState[cmd.BankNum];
        const bankHistory = this.bankHistory[cmd.BankNum];
        const groupHistory = this.groupHistory[cmd.BankGroup];

        cmd.NotLatched = this.tCR - 1;
        this.currentCommand = cmd;

        switch (cmd.Command) {
            case MemCommandEnum.REF:
                this.sinceRefresh -= this.tREFI;
                for (let i = 0; i < MemoryController.BANKS; i++) {
                    this.bankState[i].State = BankStateEnum.Refreshing;
                    this.bankState[i].StateCycles = 1 - this.tCR;
                }
                break;
            case MemCommandEnum.PRE:
                if (!cmd.AutoPrecharge) {
                    bankState.State = BankStateEnum.Precharging;
                    bankState.StateCycles = 1 - this.tCR;
                    bankState.CurrentOpenRow = null;
                } else {
                    for (let i = 0; i < MemoryController.BANKS; i++) {
                        if (this.bankState[i].State === BankStateEnum.Active && !this.bankState[i].WriteTxs) {
                            this.bankState[i].State = BankStateEnum.Precharging;
                            this.bankState[i].StateCycles = 1 - this.tCR;
                        }
                    }
                }
                break;
            case MemCommandEnum.ACT:
                bankState.State = BankStateEnum.Activating;
                bankState.StateCycles = 1 - this.tCR;
                bankState.CurrentOpenRow = cmd.Address;
                bankHistory.SinceActivate = 1 - this.tCR;
                groupHistory.SinceActivate = 1 - this.tCR;
                this.rankHistory.SinceActivate = 1 - this.tCR;
                this.fawTracking.push(0);
                break;
            case MemCommandEnum.READ:
                bankState.WillPrecharge = cmd.AutoPrecharge;
                bankHistory.SinceRead = 1 - this.tCR;
                groupHistory.SinceRead = 1 - this.tCR;
                this.rankHistory.SinceRead = 1 - this.tCR;
                this.scheduleDqs(cmd, false);
                break;
            case MemCommandEnum.WRITE:
                bankState.WillPrecharge = cmd.AutoPrecharge;
                bankState.WriteTxs++;
                bankHistory.SinceWrite = 1 - this.tCR;
                groupHistory.SinceWrite = 1 - this.tCR;
                this.rankHistory.SinceWrite = 1 - this.tCR;
                this.scheduleDqs(cmd, false);
                break;
        }
    }

    public DoCycle(): void {
        if (this.currentCommand) {
            if (!this.currentCommand.NotLatched) {
                this.currentCommand = null;
            } else {
                this.currentCommand.NotLatched--;
            }
        }

        this.currentCycle++;
        this.sinceRefresh++;
        this.rankHistory.doCycle();
        this.groupHistory.forEach(v => v.doCycle());
        this.bankHistory.forEach(v => v.doCycle());
        this.bankState.forEach(v => v.doCycle());
        this.dqsSchedule.forEach(v => v.DueCycles--);
        for (let i = 0; i < this.fawTracking.length; i++) {
            this.fawTracking[i]++;
        }
        if (this.fawTracking.length && this.fawTracking[0] >= this.tFAW) {
            this.fawTracking.shift();
        }

        for (let i = 0; i < MemoryController.BANKS; i++) {
            const bankState = this.bankState[i];
            const bankHistory = this.bankHistory[i];

            switch (bankState.State) {
                case BankStateEnum.Idle:
                    break;
                case BankStateEnum.Activating:
                    if (bankState.StateCycles + this.tCR > this.tRCD) {
                        bankState.State = BankStateEnum.Active;
                        bankState.StateCycles = 0;
                    }
                    break;
                case BankStateEnum.Refreshing:
                    if (bankState.StateCycles + this.tCR > this.tRFC) {
                        bankState.State = BankStateEnum.Idle;
                        bankState.StateCycles = 0;
                    }
                    break;
                case BankStateEnum.Precharging:
                    if (bankState.StateCycles + this.tCR > this.tRP) {
                        bankState.State = BankStateEnum.Idle;
                        bankState.StateCycles = 0;
                    }
                    break;
                case BankStateEnum.Active:
                    if (bankState.WillPrecharge &&
                        !bankState.WriteTxs &&
                        bankHistory.SinceRead + this.tCR > this.tRTP &&
                        bankHistory.SinceWriteData + this.tCR > this.tWR &&
                        bankHistory.SinceActivate + this.tCR > this.tRAS) {
                        bankState.State = BankStateEnum.Precharging;
                        bankState.StateCycles = 1 - this.tCR;
                    }
                    break;
            }
        }

        if (this.sinceRefresh < 4 * this.tREFI) {
            if (this.imcCommandQueue.length) {
                const imcCommand = this.imcCommandQueue.shift();
                const [bankNum, row, column] = MemoryController.MapAddress(imcCommand.Address, this.x16Mode);
                const bankQueue = this.bankCommandQueue[bankNum];

                if (bankQueue.OpenRow !== row) {
                    if (bankQueue.OpenRow !== null)
                        bankQueue.QueueCommand(new MemCommand(MemCommandEnum.PRE, bankNum, 0));

                    bankQueue.QueueCommand(new MemCommand(MemCommandEnum.ACT, bankNum, row));
                }

                bankQueue.QueueCommand(new MemCommand(imcCommand.IsWrite ? MemCommandEnum.WRITE : MemCommandEnum.READ, bankNum, column));
            } else if (this.sinceRefresh >= (-4 * this.tREFI)) {
                this.maybeEnqueueRefresh();
            }
        } else {
            this.maybeEnqueueRefresh();
        }

        const canIssue = [];
        for (let i = 0; i < MemoryController.BANKS; i++) {
            const bankState = this.bankState[i];
            const bankHistory = this.bankHistory[i];
            const groupHistory = this.groupHistory[i >> 2];
            canIssue.push(!this.gearDown || (this.tCR & 1) == (this.currentCycle & 1));
            canIssue[i] &&= this.currentCommand === null;

            if (!this.bankCommandQueue[i].Empty) {
                const cmd = this.bankCommandQueue[i].FirstCommand;
                switch(cmd.Command) {
                    case MemCommandEnum.ACT:
                        canIssue[i] &&= bankState.State === BankStateEnum.Idle;
                        canIssue[i] &&= bankHistory.SinceActivate + this.tCR > this.tRC;
                        canIssue[i] &&= groupHistory.SinceActivate + this.tCR > this.tRRDl;
                        canIssue[i] &&= this.rankHistory.SinceActivate + this.tCR > this.tRRDs;
                        canIssue[i] &&= this.fawTracking.length < 4;
                        break;
                    case MemCommandEnum.REF:
                        canIssue[i] &&= bankState.State === BankStateEnum.Idle;
                        canIssue[i] &&= bankHistory.SinceActivate + this.tCR > this.tRC;
                        break;
                    case MemCommandEnum.PRE:
                        canIssue[i] &&= bankState.State === BankStateEnum.Active || cmd.AutoPrecharge;
                        canIssue[i] &&= bankState.State !== BankStateEnum.Refreshing;
                        canIssue[i] &&= bankState.State !== BankStateEnum.Activating;
                        canIssue[i] &&= !bankState.WriteTxs;
                        canIssue[i] &&= bankHistory.SinceActivate + this.tCR > this.tRAS;
                        canIssue[i] &&= bankHistory.SinceRead + this.tCR > this.tRTP;
                        canIssue[i] &&= bankHistory.SinceWriteData + this.tCR > this.tWR;
                        break;
                    case MemCommandEnum.READ:
                        canIssue[i] &&= bankState.State === BankStateEnum.Active;
                        canIssue[i] &&= !bankState.WriteTxs;
                        canIssue[i] &&= groupHistory.SinceRead + this.tCR > this.tCCDl;
                        canIssue[i] &&= groupHistory.SinceWrite + this.tCR > this.tCCDl;
                        canIssue[i] &&= groupHistory.SinceWriteData + this.tCR > this.tWTRl;
                        canIssue[i] &&= this.rankHistory.SinceRead + this.tCR > this.tCCDs;
                        canIssue[i] &&= this.rankHistory.SinceWrite + this.tCR > this.tCCDs;
                        canIssue[i] &&= this.rankHistory.SinceWriteData + this.tCR > this.tWTRs;
                        canIssue[i] &&= this.scheduleDqs(cmd, true);
                        break;
                    case MemCommandEnum.WRITE:
                        canIssue[i] &&= bankState.State === BankStateEnum.Active;
                        canIssue[i] &&= groupHistory.SinceRead + this.tCR > this.tCCDl;
                        canIssue[i] &&= groupHistory.SinceWrite + this.tCR > this.tCCDl;
                        canIssue[i] &&= this.rankHistory.SinceRead + this.tCR > this.tCCDs;
                        canIssue[i] &&= this.rankHistory.SinceWrite + this.tCR > this.tCCDs;
                        canIssue[i] &&= this.scheduleDqs(cmd, true);
                        break;
                }
            }
        }

        let allBankCommand = false;
        if (canIssue.every(v => v)) {
            if (this.bankCommandQueue.every(v => !v.Empty && v.FirstCommand.Command === MemCommandEnum.PRE)) {
                this.issuePrechargeAllBanks();
                allBankCommand = true;
            }

            if (this.bankCommandQueue.every(v => !v.Empty && v.FirstCommand.Command === MemCommandEnum.REF)) {
                this.issueRefresh();
                allBankCommand = true;
            }

            if (allBankCommand) {
                this.bankCommandQueue.forEach(v => v.DequeueCommand());
            }
        }

        if (!allBankCommand) {
            for (let i = 0; i < MemoryController.BANKS; i++) {
                if (this.bankCommandQueue[i].Empty) continue;
                if (!canIssue[i]) continue;

                const cmd = this.bankCommandQueue[i].FirstCommand;
                if (cmd.Command === MemCommandEnum.PRE && cmd.AutoPrecharge) continue;
                if (cmd.Command === MemCommandEnum.REF) continue;
                this.bankCommandQueue[i].DequeueCommand();

                if (this.UseAutoPrecharge && (cmd.Command === MemCommandEnum.READ || cmd.Command === MemCommandEnum.WRITE)) {
                    if (!this.bankCommandQueue[i].Empty && this.bankCommandQueue[i].FirstCommand.Command === MemCommandEnum.PRE && !this.bankCommandQueue[i].FirstCommand.AutoPrecharge) {
                        cmd.AutoPrecharge = true;
                        this.bankCommandQueue[i].DequeueCommand();
                    }
                }

                this.issueCommand(cmd);
                break;
            }
        }

        this.dqActive = null;
        this.dqsActive = false;

        if (this.dqsSchedule.length) {
            let dqs = this.dqsSchedule[0];
            switch(dqs.DueCycles) {
                case -3:
                    this.dqsSchedule.shift();
                    if (dqs.Command.Command === MemCommandEnum.WRITE) {
                        this.bankState[dqs.Command.BankNum].WriteTxs--;
                        this.bankHistory[dqs.Command.BankNum].SinceWriteData = -1;
                        this.groupHistory[dqs.Command.BankGroup].SinceWriteData = -1;
                        this.rankHistory.SinceWriteData = -1;
                    }
                    /* fallthrough */
                case -2:
                case -1:
                case 0:
                    this.dqActive = [dqs.Command.Command, dqs.RowNumber, dqs.Command.BankGroup, dqs.Command.Bank, dqs.Command.Address - dqs.DueCycles * 2];
                    this.dqsActive = true;
                    break;
                case 1:
                case 2:
                    this.dqsActive = dqs.Preamble >= dqs.DueCycles;
                    break;
            }
        }
    }

    public static MapAddress(addr: number, x16: boolean) : [number, number, number] {
        const column = addr & 0x3F8;
        addr >>>= 10;
        const bankNum = addr & (x16 ? 0x7 : 0xF);
        const row = addr >> (x16 ? 3 : 4);

        return [bankNum, row, column];
    }
}

class BankState {
    public State: BankStateEnum;
    public StateCycles: number;
    public CurrentOpenRow: number;
    public WriteTxs: number;
    public WillPrecharge: boolean;

    public constructor() {
        this.State = BankStateEnum.Idle;
        this.StateCycles = 65535;
        this.CurrentOpenRow = null;
        this.WriteTxs = 0;
        this.WillPrecharge = false;
    }

    public doCycle() {
        if (this.State === BankStateEnum.Idle) return;
        if (this.State === BankStateEnum.Active) return;

        this.StateCycles++;
    }
}

class CommandQueue {
    private readonly queue: MemCommand[];
    private openRow: number;

    get Empty(): boolean { return !this.queue.length; }
    get OpenRow(): number { return this.openRow; }
    get FirstCommand(): MemCommand { return this.queue[0]; }
    public DequeueCommand(): MemCommand { return this.queue.shift(); }

    public constructor() {
        this.queue = [];
        this.openRow = null;
    }

    public QueueCommand(cmd: MemCommand) {
        this.queue.push(cmd);
        switch(cmd.Command) {
            case MemCommandEnum.PRE:
                this.openRow = null;
                break;
            case MemCommandEnum.ACT:
                this.openRow = cmd.Address;
                break;
        }
    }
}

class CommandHistory {
    public SinceRead: number;
    public SinceWrite: number;
    public SinceWriteData: number;
    public SinceActivate: number;

    public constructor() {
        this.SinceActivate = 65535;
        this.SinceWriteData = 65535;
        this.SinceWrite = 65535;
        this.SinceRead = 65535;
    }

    public doCycle() {
        this.SinceRead++;
        this.SinceWrite++;
        this.SinceWriteData++;
        this.SinceActivate++;
    }
}

interface ImcCommand {
    Cycle?: number;
    IsWrite: boolean;
    Address: number;
}

class DqsSchedule {
    public DueCycles: number;
    public Command: MemCommand;
    public RowNumber: number;
    public Preamble: number;

    public constructor(cycles: number, row: number, cmd: MemCommand, pre: number) {
        this.DueCycles = cycles;
        this.RowNumber = row;
        this.Command = cmd;
        this.Preamble = pre;
    }
}

function $x(e) { return document.getElementById(e); }
function toHex(v: number, len: number) {
    let s = v.toString(16).toUpperCase();
    while (s.length < len) s = '0' + s;
    return s;
}

const stateKey = 'SAVE';
const cmdTable = Array.prototype.slice.apply($x('cmdTable').childNodes).filter(v => v.tagName === "TBODY")[0];
const allTimings = ['tCL',
    'tCWL',
    'tRCD',
    'tRP',
    'tRAS',
    'tRC',
    'tRRDs',
    'tRRDl',
    'tFAW',
    'tWTRs',
    'tWTRl',
    'tWR',
    'tRTP',
    'tCCDl',
    'tCCDs',
    'tREFI',
    'tRFC',
    'tCR',
    'gearDown',
    'x16',
'cycles',
'allCycles',
'useAP'];

function saveState(imcCommands: ImcCommand[]) {
    const timings = {};
    for (let i = 0; i < allTimings.length; i++) {
        const ele = <HTMLInputElement>$x(allTimings[i]);
        let val: any = ele.value;
        if (ele.type === "checkbox") val = ele.checked;
        if (ele.type === "number") val = parseInt(ele.value);
        timings[allTimings[i]] = val;
    }

    localStorage.setItem(stateKey, JSON.stringify({
        timings: timings,
        commands: imcCommands
    }));
}

function loadState() {
    const state = JSON.parse(localStorage.getItem(stateKey));
    if (state?.timings) {
        for (let i = 0; i < allTimings.length; i++) {
            let val: any = state?.timings[allTimings[i]];
            if (val === undefined)
                continue;

            const ele = <HTMLInputElement>$x(allTimings[i]);
            if (ele.type === "checkbox")
                ele.checked = !!val;
            else
                ele.value = val?.toString();
        }
    }

    if (state?.commands?.length) {
        for (let i = 0; i < state.commands.length; i++) {
            const cmd = state.commands[i];
            if (cmd && cmd.Cycle !== undefined && cmd.Address !== undefined && cmd.IsWrite !== undefined) {
                const [ci, rw, ai] = addCmdRow();
                ci.value = (1 + cmd.Cycle).toString();
                rw.checked = !!cmd.IsWrite;
                ai.value = toHex(cmd.Address, 8);
            }
        }
    } else {
        addCmdRow();
    }
}

$x('go').onclick = function () {
    const cycleTable = $x('cycleTable');
    const tableBody = document.createElement('tbody');
    for (let i = 0; i < cycleTable.childNodes.length; i++) {
        if ((<HTMLElement>cycleTable.childNodes[i]).tagName === "THEAD") continue;
        cycleTable.removeChild(cycleTable.childNodes[i]);
        i--;
    }
    cycleTable.appendChild(tableBody);

    const mc = new MemoryController(
        parseInt((<HTMLInputElement>$x('tCL')).value),
        parseInt((<HTMLInputElement>$x('tCWL')).value),
        parseInt((<HTMLInputElement>$x('tRCD')).value),
        parseInt((<HTMLInputElement>$x('tRP')).value),
        parseInt((<HTMLInputElement>$x('tRAS')).value),
        parseInt((<HTMLInputElement>$x('tRC')).value),
        parseInt((<HTMLInputElement>$x('tRRDs')).value),
        parseInt((<HTMLInputElement>$x('tRRDl')).value),
        parseInt((<HTMLInputElement>$x('tFAW')).value),
        parseInt((<HTMLInputElement>$x('tWTRs')).value),
        parseInt((<HTMLInputElement>$x('tWTRl')).value),
        parseInt((<HTMLInputElement>$x('tWR')).value),
        parseInt((<HTMLInputElement>$x('tRTP')).value),
        parseInt((<HTMLInputElement>$x('tCCDl')).value),
        parseInt((<HTMLInputElement>$x('tCCDs')).value),
        parseInt((<HTMLInputElement>$x('tREFI')).value),
        parseInt((<HTMLInputElement>$x('tRFC')).value),
        parseInt((<HTMLInputElement>$x('tCR')).value),
        (<HTMLInputElement>$x('gearDown')).checked,
        (<HTMLInputElement>$x('x16')).checked,
    );

    mc.UseAutoPrecharge = !!(<HTMLInputElement>$x('useAP')).checked;
    const cycles = parseInt((<HTMLInputElement>$x('cycles')).value);
    const allCycles = (<HTMLInputElement>$x('allCycles')).checked;
    const imcCommands: ImcCommand[] = [];
    const cmdNodes = cmdTable.childNodes;
    for (let i = 0; i < cmdNodes.length; i++) {
        if (cmdNodes[i].tagName === "TR") {
            const cycle = cmdNodes[i].querySelector('input[type=number]').value - 1;
            const addr = parseInt(cmdNodes[i].querySelector('input[type=text]').value, 16);
            const isWr = cmdNodes[i].querySelector('input[type=checkbox]').checked;
            imcCommands.push({Cycle: cycle, Address: addr, IsWrite: isWr});
        } else {
            cmdTable.removeChild(cmdNodes[i]);
            i--;
        }
    }

    imcCommands.sort((a, b) => a.Cycle - b.Cycle);
    saveState(imcCommands);
    let outputDesCycle = true;
    for (let i = 0; i < cycles; i++) {
        while(imcCommands.length && imcCommands[0].Cycle === mc.CurrentCycle) {
            mc.EnqueueCommand(imcCommands.shift());
        }

        mc.DoCycle();
        outputDesCycle ||= mc.DqsActive;
        let row: HTMLElement;

        if (mc.CurrentCommand) {
            row = document.createElement('tr');
            tableBody.appendChild(row);

            let cell = document.createElement('td');
            cell.innerText = mc.CurrentCycle.toString();
            row.appendChild(cell);

            const cmd = mc.CurrentCommand;
            const cmdClass = cmd.NotLatched ? 'latching' : 'active';

            // Command
            cell = document.createElement('td');
            switch (cmd.Command) {
                case MemCommandEnum.READ: cell.innerHTML = `Read`; break;
                case MemCommandEnum.WRITE: cell.innerHTML = `Write`; break;
                case MemCommandEnum.ACT: cell.innerHTML = `Activate`; break;
                case MemCommandEnum.PRE: cell.innerHTML = "Precharge"; break;
                case MemCommandEnum.REF: cell.innerHTML = "Refresh"; break;
            }

            if (cmd.AutoPrecharge) {
                if (cmd.Command !== MemCommandEnum.PRE)
                    cell.innerText += "/AP";
            }

            cell.className = cmdClass;
            row.appendChild(cell);

            // BG/BA
            cell = document.createElement('td');
            cell.className = cmdClass;
            cell.innerText = `${cmd.BankGroup}/${cmd.Bank}`;
            switch (cmd.Command) {
                case MemCommandEnum.REF: cell.innerText = "All"; break;
                case MemCommandEnum.PRE: if (cmd.AutoPrecharge) cell.innerText = "All"; break;
            }
            row.appendChild(cell);

            switch (cmd.Command) {
                case MemCommandEnum.ACT:
                    cell = document.createElement('td');
                    cell.innerText = `L`;
                    cell.className = 'logT actCol';
                    row.appendChild(cell);

                    cell = document.createElement('td');
                    cell.innerText = `${toHex(cmd.Address, 5)}`;
                    cell.className = cmdClass;
                    cell.colSpan = 7;
                    row.appendChild(cell);
                    break;
                case MemCommandEnum.READ:
                case MemCommandEnum.WRITE:
                    cell = document.createElement('td');
                    cell.innerText = `H`;
                    cell.className = 'logF actCol';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass + ' a17Col';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `H`;
                    cell.className = 'logF';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `L`;
                    cell.className = 'logT';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = (cmd.Command === MemCommandEnum.READ) ? `H` : 'L';
                    cell.className = (cmd.Command === MemCommandEnum.READ) ? `logF` : 'logT';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass;
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = cmd.AutoPrecharge ? `H` : 'L';
                    cell.className = cmd.AutoPrecharge ? `logT` : 'logF';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `${toHex(cmd.Address, 3)}`;
                    cell.className = cmdClass;
                    row.appendChild(cell);
                    break;
                case MemCommandEnum.PRE:
                    cell = document.createElement('td');
                    cell.innerText = `H`;
                    cell.className = 'logF actCol';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass + ' a17Col';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `L`;
                    cell.className = 'logT';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `H`;
                    cell.className = 'logF';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = 'L';
                    cell.className = 'logT';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass;
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = cmd.AutoPrecharge ? `H` : 'L';
                    cell.className = cmd.AutoPrecharge ? `logT` : 'logF';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass;
                    row.appendChild(cell);
                    break;
                case MemCommandEnum.REF:
                    cell = document.createElement('td');
                    cell.innerText = `H`;
                    cell.className = 'logF actCol';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass + ' a17Col';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `L`;
                    cell.className = 'logT';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = 'L';
                    cell.className = 'logT';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `H`;
                    cell.className = 'logF';
                    row.appendChild(cell);
                    cell = document.createElement('td');
                    cell.innerText = `-`;
                    cell.className = cmdClass;
                    cell.colSpan = 3;
                    row.appendChild(cell);
                    break;
            }

            outputDesCycle = true;
        } else if (outputDesCycle || allCycles) {
            row = document.createElement('tr');
            tableBody.appendChild(row);

            let cell = document.createElement('td');
            cell.innerText = mc.CurrentCycle.toString();
            row.appendChild(cell);

            cell = document.createElement('td');
            cell.colSpan = 10;
            cell.className = 'inactive';
            row.appendChild(cell);

            outputDesCycle = false;
        }

        if (row) {
            let cell = document.createElement('td');
            cell.innerText = mc.DqsActive ? `⭜⭝` : '';
            if (mc.DqsActive) {
                cell.className = mc.DqActive ? 'active' : 'latching';
            } else {
                cell.className = 'inactive';
            }
            row.appendChild(cell);

            let dq: string[] = ['', ''];
            dq[0] = (mc.DqActive && mc.DqActive[0] === MemCommandEnum.READ) ? 'R' : 'W';
            dq[1] = toHex(mc.DqAddress ?? 0, 8);
            cell = document.createElement('td');
            cell.innerText = mc.DqActive ? dq.join(' ') : '';
            cell.className = mc.DqActive ? 'active' : 'inactive';
            row.appendChild(cell);

            if (mc.DqActive || mc.DqsActive)
                outputDesCycle = true;
        }
    }


}

function addCmdRow() {
    const row = document.createElement('tr');

    let cell = document.createElement('td');
    const cycleInput = document.createElement('input');
    cycleInput.type = 'number';
    cycleInput.min = cycleInput.value = '1';
    cycleInput.max = '999999';
    cell.appendChild(cycleInput);
    row.appendChild(cell);

    cell = document.createElement('td');
    const rwInput = document.createElement('input');
    rwInput.type = 'checkbox';
    rwInput.className = 'rwCheckBox';
    cell.appendChild(rwInput);
    row.appendChild(cell);

    cell = document.createElement('td');
    const addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.pattern = '[0-9a-fA-F]{1,8}';
    cell.appendChild(addrInput);
    row.appendChild(cell);

    const mapAddrCell = document.createElement('td');
    row.appendChild(mapAddrCell);

    function updateMapAddr() {
        const addr = parseInt(addrInput.value, 16);
        const [bankNum, aRow, col] = MemoryController.MapAddress(addr, (<HTMLInputElement>$x('x16')).checked);
        const bankGroup = bankNum >> 2;
        const bank = bankNum & 3;
        mapAddrCell.innerText = `${bankGroup}/${bank}/${toHex(aRow, 5)}/${toHex(col, 3)}`;

        if (!row.isConnected) {
            $x('x16').removeEventListener('change', updateMapAddr);
        }
    }

    addrInput.onkeyup = updateMapAddr;
    $x('x16').addEventListener('change', updateMapAddr);

    cell = document.createElement('td');
    const addButton = document.createElement('button');
    addButton.innerHTML = '+';
    addButton.onclick = addCmdRow;
    cell.appendChild(addButton);
    cell.appendChild(document.createTextNode(' '));
    const delButton = document.createElement('button');
    delButton.innerHTML = '-';
    delButton.onclick = function() {
        cmdTable.removeChild(row);
        $x('x16').removeEventListener('change', updateMapAddr);
    }
    cell.appendChild(delButton);
    row.appendChild(cell);

    cmdTable.appendChild(row);
    return [cycleInput, rwInput, addrInput];
}

loadState();
