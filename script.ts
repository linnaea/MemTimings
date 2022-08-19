enum BankStateEnum {
    Idle, Refreshing, Activating, Active, Precharging
}

enum MemCommandEnum {
    REF, ACT, PRE, READ,WRITE
}

interface ImcCommand {
    Cycle?: number;
    IsWrite: boolean;
    Address: number;
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

    public toString(): string {
        let cmd: string;
        switch (this.Command) {
            case MemCommandEnum.REF:
                return 'Refresh';
            case MemCommandEnum.PRE:
                cmd = 'PRE';
                break;
            case MemCommandEnum.READ:
                cmd = 'READ';
                break;
            case MemCommandEnum.WRITE:
                cmd = 'WRITE';
                break;
            case MemCommandEnum.ACT:
                return `ACT ${toHex(this.Address, 5)}`;
        }

        if (this.AutoPrecharge) cmd += "/A";
        if (this.Command === MemCommandEnum.PRE) return cmd;

        cmd += ' ';
        cmd += toHex(this.Address, 3);
        return cmd;
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

        if (this.StateCycles < 65535)
            this.StateCycles++;
    }
}

class CommandQueue {
    private readonly queue: MemCommand[];
    private openRow: number;

    private canIssue: boolean;

    public IssueChecks: [boolean, string][];
    public CheckCmd: MemCommand;
    get Empty(): boolean { return !this.queue.length; }
    get OpenRow(): number { return this.openRow; }
    get FirstCommand(): MemCommand { return this.queue[0]; }
    get AllCommand(): MemCommand[] { return this.queue.slice(0); }
    get CanIssue(): boolean { return this.canIssue; }
    public DequeueCommand(): MemCommand { return this.queue.shift(); }

    public constructor() {
        this.queue = [];
        this.openRow = null;
        this.StartIssueCheck();
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

    public StartIssueCheck() {
        this.CheckCmd = this.FirstCommand;
        this.canIssue = !this.Empty;
        this.IssueChecks = [];
    }

    public IssueCheck(pass: boolean, desc: string) {
        this.IssueChecks.push([pass, desc]);
        this.canIssue = pass && this.canIssue;
    }

    public TimingCheck(toCheck, target, name, desc) {
        this.IssueCheck(toCheck > target, `${desc}: ${toCheck} > ${target}(${name})`);
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
        if (this.SinceRead < 65535) this.SinceRead++;
        if (this.SinceWrite < 65535) this.SinceWrite++;
        if (this.SinceWriteData < 65535) this.SinceWriteData++;
        if (this.SinceActivate < 65535) this.SinceActivate++;
    }
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
    private readonly bgBits: number;
    private readonly gearDown: boolean;
    public UseAutoPrecharge: boolean;

    public readonly BankState: BankState[];
    public readonly BankHistory: CommandHistory[];
    public readonly GroupHistory: CommandHistory[];
    public readonly RankHistory: CommandHistory;
    public readonly BankCmdQueue: CommandQueue[];

    private readonly imcCommandQueue: ImcCommand[];
    private readonly dqsSchedule: DqsSchedule[];
    private readonly fawTracking: number[];

    private currentCycle: number;
    private sinceRefresh: number;
    private currentCommand: MemCommand;
    private dqsActive: boolean;
    private dqActive: [MemCommandEnum, number, number, number, number];

    get CurrentCycle(): number { return this.currentCycle; }
    get CurrentCommand(): MemCommand { return this.currentCommand; }
    get DqsActive(): boolean { return this.dqsActive; }
    get DqActive(): [MemCommandEnum, number, number, number, number] { return this.dqActive; }
    get DqAddress(): number {
        if(!this.dqActive) return null;
        let addr = this.dqActive[4];
        addr |= this.dqActive[3] << 10;
        addr |= this.dqActive[2] << 12;
        addr |= this.dqActive[1] << (12 + this.bgBits);
        return addr;
    }

    public constructor(tCL: number, tCWL: number, tRCD: number, tRP: number, tRAS: number, tRC: number,
                       tRRDs: number, tRRDl: number, tFAW: number, tWTRs: number, tWTRl: number,
                       tWR: number, tRTP: number, tCCDl: number, tCCDs: number,
                       tREFI: number, tRFC: number, tCR: number, gdm: boolean, bgBits: number) {
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
        this.bgBits = bgBits;
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
        this.RankHistory = new CommandHistory();

        this.GroupHistory = [new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),];

        this.BankCmdQueue = [
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),
            new CommandQueue(),new CommandQueue(),new CommandQueue(),new CommandQueue(),];

        this.BankHistory = [
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),
            new CommandHistory(),new CommandHistory(),new CommandHistory(),new CommandHistory(),];

        this.BankState = [
            new BankState(),new BankState(),new BankState(),new BankState(),
            new BankState(),new BankState(),new BankState(),new BankState(),
            new BankState(),new BankState(),new BankState(),new BankState(),
            new BankState(),new BankState(),new BankState(),new BankState(),];
    }

    public EnqueueCommand(cmd: ImcCommand): void {
        this.imcCommandQueue.push(cmd);
    }

    private maybeEnqueueRefresh(): void {
        if (this.BankCmdQueue.every(q => q.Empty) && this.BankState.every(q => q.State !== BankStateEnum.Refreshing)) {
            const preCommand = new MemCommand(MemCommandEnum.PRE, 0, 0);
            preCommand.AutoPrecharge = true;
            const refreshCommand = new MemCommand(MemCommandEnum.REF, 0, 0);

            if (!this.BankCmdQueue.every(q => q.OpenRow === null)) {
                this.BankCmdQueue.forEach(q => q.QueueCommand(preCommand));
            }

            this.BankCmdQueue.forEach(q => q.QueueCommand(refreshCommand));
        }
    }

    private scheduleDqs(cmd: MemCommand, dryRun: boolean): [boolean, number, number] {
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
            return [false, totalCycles, delay];

        if (dryRun)
            return [true, totalCycles, delay];

        if (nextDqs)
            nextDqs.Preamble = nextNeedsPreamble ? nextPreamble : 0;

        this.dqsSchedule.splice(i, 0,
            new DqsSchedule(delay, this.BankState[cmd.BankNum].CurrentOpenRow, cmd, needsPreamble ? preamble : 0));

        return [true, totalCycles, delay];
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
        const bankState = this.BankState[cmd.BankNum];
        const bankHistory = this.BankHistory[cmd.BankNum];
        const groupHistory = this.GroupHistory[cmd.BankGroup];

        cmd.NotLatched = this.tCR - 1;
        this.currentCommand = cmd;

        switch (cmd.Command) {
            case MemCommandEnum.REF:
                this.sinceRefresh -= this.tREFI;
                for (let i = 0; i < MemoryController.BANKS; i++) {
                    this.BankState[i].State = BankStateEnum.Refreshing;
                    this.BankState[i].StateCycles = 1 - this.tCR;
                }
                break;
            case MemCommandEnum.PRE:
                if (!cmd.AutoPrecharge) {
                    bankState.State = BankStateEnum.Precharging;
                    bankState.StateCycles = 1 - this.tCR;
                    bankState.CurrentOpenRow = null;
                } else {
                    for (let i = 0; i < MemoryController.BANKS; i++) {
                        if (this.BankState[i].State === BankStateEnum.Active && !this.BankState[i].WriteTxs) {
                            this.BankState[i].State = BankStateEnum.Precharging;
                            this.BankState[i].StateCycles = 1 - this.tCR;
                            this.BankState[i].CurrentOpenRow = null;
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
                this.RankHistory.SinceActivate = 1 - this.tCR;
                this.fawTracking.push(0);
                break;
            case MemCommandEnum.READ:
                bankState.WillPrecharge = cmd.AutoPrecharge;
                bankHistory.SinceRead = 1 - this.tCR;
                groupHistory.SinceRead = 1 - this.tCR;
                this.RankHistory.SinceRead = 1 - this.tCR;
                this.scheduleDqs(cmd, false);
                break;
            case MemCommandEnum.WRITE:
                bankState.WillPrecharge = cmd.AutoPrecharge;
                bankState.WriteTxs++;
                bankHistory.SinceWrite = 1 - this.tCR;
                groupHistory.SinceWrite = 1 - this.tCR;
                this.RankHistory.SinceWrite = 1 - this.tCR;
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
        this.RankHistory.doCycle();
        this.GroupHistory.forEach(v => v.doCycle());
        this.BankHistory.forEach(v => v.doCycle());
        this.BankState.forEach(v => v.doCycle());
        this.dqsSchedule.forEach(v => v.DueCycles--);
        for (let i = 0; i < this.fawTracking.length; i++) {
            this.fawTracking[i]++;
        }
        if (this.fawTracking.length && this.fawTracking[0] >= this.tFAW) {
            this.fawTracking.shift();
        }

        for (let i = 0; i < MemoryController.BANKS; i++) {
            const bankState = this.BankState[i];
            const bankHistory = this.BankHistory[i];

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
                        bankState.CurrentOpenRow = null;
                        bankState.StateCycles = 1 - this.tCR;
                    }
                    break;
            }
        }

        if (this.sinceRefresh < 4 * this.tREFI) {
            if (this.imcCommandQueue.length) {
                const imcCommand = this.imcCommandQueue.shift();
                const [bankNum, row, column] = MemoryController.MapAddress(imcCommand.Address, this.bgBits);
                const bankQueue = this.BankCmdQueue[bankNum];

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

        for (let i = 0; i < MemoryController.BANKS; i++) {
            const bankQueue = this.BankCmdQueue[i];
            const bankState = this.BankState[i];
            const bankHistory = this.BankHistory[i];
            const groupHistory = this.GroupHistory[i >> 2];
            let dqsSchedule;

            bankQueue.StartIssueCheck();
            bankQueue.IssueCheck(this.currentCommand === null, "C/A bus available");
            if (this.gearDown) {
                bankQueue.IssueCheck((this.tCR & 1) == (this.currentCycle & 1), "Gear-Down Latching Cycle");
            }

            if (!bankQueue.Empty) {
                const cmd = bankQueue.FirstCommand;
                switch(cmd.Command) {
                    case MemCommandEnum.ACT:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Idle, "Bank idle");
                        bankQueue.TimingCheck(bankHistory.SinceActivate + this.tCR, this.tRC, "tRC", "Since ACT in bank");
                        bankQueue.TimingCheck(groupHistory.SinceActivate + this.tCR, this.tRRDl, "tRRD_L", "Since ACT in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceActivate + this.tCR, this.tRRDs, "tRRD_S", "Since ACT in rank");
                        bankQueue.IssueCheck(this.fawTracking.length < 4, `ACTs in rank in tFAW: [${this.fawTracking.join(', ')}]`);
                        break;
                    case MemCommandEnum.REF:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Idle, "Bank idle");
                        bankQueue.TimingCheck(bankHistory.SinceActivate + this.tCR, this.tRC, "tRC", "Since ACT in bank");
                        break;
                    case MemCommandEnum.PRE:
                        if (cmd.AutoPrecharge) {
                            bankQueue.IssueCheck(
                                bankState.State === BankStateEnum.Active
                                || bankState.State === BankStateEnum.Precharging
                                || bankState.State === BankStateEnum.Idle, "PreA: Bank active or idle");
                        } else {
                            bankQueue.IssueCheck(bankState.State === BankStateEnum.Active, "Bank active");
                        }

                        bankQueue.IssueCheck(!bankState.WriteTxs, `In-flight WRITEs: ${bankState.WriteTxs}`);
                        bankQueue.TimingCheck(bankHistory.SinceActivate + this.tCR, this.tRAS, "tRAS", "Since ACT");
                        bankQueue.TimingCheck(bankHistory.SinceRead + this.tCR, this.tRTP, "tRTP", "Since READ");
                        bankQueue.TimingCheck(bankHistory.SinceWriteData + this.tCR, this.tWR, "tWR", "Since WRITE Tx");
                        break;
                    case MemCommandEnum.READ:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Active, "Bank active");
                        bankQueue.IssueCheck(!bankState.WriteTxs, `In-flight WRITEs: ${bankState.WriteTxs}`);

                        bankQueue.TimingCheck(groupHistory.SinceRead + this.tCR, this.tCCDl, "tCCD_L/tRdRd_sg/tRdRdScL", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWrite + this.tCR, this.tCCDl, "tCCD_L/tWrRd_sg/tWrRd", "Since WRITE in group");
                        bankQueue.TimingCheck(groupHistory.SinceWriteData + this.tCR, this.tWTRl, "tWTR_L", "Since WRITE Tx in group");

                        bankQueue.TimingCheck(this.RankHistory.SinceRead + this.tCR, this.tCCDs, "tCCD_S/tRdRd_dg/tRdRdSc", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWrite + this.tCR, this.tCCDs, "tCCD_S/tWrRd_dg/tWrRd", "Since WRITE in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWriteData + this.tCR, this.tWTRs, "tWTR_S", "Since WRITE Tx in rank");

                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], `DQS available for ${dqsSchedule[1]} cycles after ${dqsSchedule[2]} cycles`);
                        break;
                    case MemCommandEnum.WRITE:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Active, "Bank is active");

                        bankQueue.TimingCheck(groupHistory.SinceRead + this.tCR, this.tCCDl, "tCCD_L/tRdWr_sg/tRdWr", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWrite + this.tCR, this.tCCDl, "tCCD_L/tWrWr_sg/tWrWrScL", "Since WRITE in group");

                        bankQueue.TimingCheck(this.RankHistory.SinceRead + this.tCR, this.tCCDs, "tCCD_S/tRdWr_dg/tRdWr", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWrite + this.tCR, this.tCCDs, "tCCD_S/tWrWr_dg/tWrWrSc", "Since WRITE in rank");

                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], `DQS available for ${dqsSchedule[1]} cycles after ${dqsSchedule[2]} cycles`);
                        break;
                }
            }
        }

        let allBankCommand = false;
        if (this.BankCmdQueue.every(v => v.CanIssue)) {
            if (this.BankCmdQueue.every(v => v.FirstCommand.Command === MemCommandEnum.PRE)) {
                this.issuePrechargeAllBanks();
                allBankCommand = true;
            }

            if (this.BankCmdQueue.every(v => v.FirstCommand.Command === MemCommandEnum.REF)) {
                this.issueRefresh();
                allBankCommand = true;
            }

            if (allBankCommand) {
                this.BankCmdQueue.forEach(v => v.DequeueCommand());
            }
        }

        if (!allBankCommand) {
            for (let i = 0; i < MemoryController.BANKS; i++) {
                if (!this.BankCmdQueue[i].CanIssue) continue;

                const cmd = this.BankCmdQueue[i].FirstCommand;
                if (cmd.Command === MemCommandEnum.PRE && cmd.AutoPrecharge) continue;
                if (cmd.Command === MemCommandEnum.REF) continue;
                this.BankCmdQueue[i].DequeueCommand();

                if (this.UseAutoPrecharge && (cmd.Command === MemCommandEnum.READ || cmd.Command === MemCommandEnum.WRITE)) {
                    if (!this.BankCmdQueue[i].Empty && this.BankCmdQueue[i].FirstCommand.Command === MemCommandEnum.PRE && !this.BankCmdQueue[i].FirstCommand.AutoPrecharge) {
                        cmd.AutoPrecharge = true;
                        this.BankCmdQueue[i].DequeueCommand();
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
                        this.BankState[dqs.Command.BankNum].WriteTxs--;
                        this.BankHistory[dqs.Command.BankNum].SinceWriteData = -1;
                        this.GroupHistory[dqs.Command.BankGroup].SinceWriteData = -1;
                        this.RankHistory.SinceWriteData = -1;
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

    public static MapAddress(addr: number, bgBits: number) : [number, number, number] {
        const column = addr & 0x3F8;
        addr >>>= 10;
        const bankNum = addr & ((1 << (bgBits + 2)) - 1);
        const row = addr >> (2 + bgBits);

        return [bankNum, row, column];
    }
}

function $x(e) { return document.getElementById(e); }
function toHex(v: number, len: number): string {
    if (v === null || v === undefined) return <any>v;

    let s = v.toString(16).toUpperCase();
    while (s.length < len) s = '0' + s;
    return s;
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
        const [bankNum, aRow, col] = MemoryController.MapAddress(addr, parseInt((<HTMLInputElement>$x('bgBits')).value));
        const bankGroup = bankNum >> 2;
        const bank = bankNum & 3;
        mapAddrCell.innerText = `${bankGroup}/${bank}/${toHex(aRow, 5)}/${toHex(col, 3)}`;

        if (!row.isConnected) {
            $x('bgBits').removeEventListener('change', updateMapAddr);
        }
    }

    addrInput.onkeyup = updateMapAddr;
    $x('bgBits').addEventListener('change', updateMapAddr);

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
        $x('bgBits').removeEventListener('change', updateMapAddr);
    }
    cell.appendChild(delButton);
    row.appendChild(cell);

    cmdTable.appendChild(row);
    return [cycleInput, rwInput, addrInput];
}

function getImcCommands() {
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
    return imcCommands;
}

const stateKey = 'SAVE';
const cmdTable = Array.prototype.slice.apply($x('cmdTable').childNodes).filter(v => v.tagName === "TBODY")[0];
const allParams = [
    'tCL',
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
    'bgBits',
    'cycles',
    'allCycles',
    'useAP'];

function saveState() {
    const timings = {};
    for (let i = 0; i < allParams.length; i++) {
        const ele = <HTMLInputElement>$x(allParams[i]);
        let val: any = ele.value;
        if (ele.type === "checkbox") val = ele.checked;
        if (ele.type === "number") val = parseInt(ele.value);
        timings[allParams[i]] = val;
    }

    return {
        params: timings,
        commands: getImcCommands()
    };
}

function loadState(state?: {
    params?: {string: number | string | boolean},
    commands?: ImcCommand[]
}) {
    if (state?.params) {
        for (let i = 0; i < allParams.length; i++) {
            let val: any = state?.params[allParams[i]];
            if (val === undefined)
                continue;

            const ele = <HTMLInputElement>$x(allParams[i]);
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
                ai.value = toHex(cmd.Address ?? 0, 8);
            }
        }
    } else {
        addCmdRow();
    }
}

let mc: MemoryController;
let mcCommands: ImcCommand[];

function createController() {
    mcCommands = getImcCommands();

    mc = new MemoryController(
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
        parseInt((<HTMLInputElement>$x('bgBits')).value),
    );

    mc.UseAutoPrecharge = !!(<HTMLInputElement>$x('useAP')).checked;
    return mc;
}

function getOrCreateController() {
    return mc ??= createController();
}

function renderCycleRow() {
    const row = document.createElement('tr');
    let cell = document.createElement('td');
    cell.innerText = mc.CurrentCycle.toString();
    row.appendChild(cell);

    if (mc.CurrentCommand) {
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
    } else {
        cell = document.createElement('td');
        cell.colSpan = 10;
        cell.className = 'inactive';
        row.appendChild(cell);
    }

    cell = document.createElement('td');
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

    return row;
}

function createTableWithHead(...title: string[]) {
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const titleRow = document.createElement('tr');

    for (let i = 0; i < title.length; i++) {
        const header = document.createElement('th');
        header.innerText = title[i];
        titleRow.appendChild(header);
    }

    thead.appendChild(titleRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);
    return [table, tbody];
}

function createTableRow(...cells: (string | number | boolean | HTMLElement | {toString(): string})[]) {
    const row = document.createElement('tr');

    for (let i = 0; i < cells.length; i++) {
        const cell = document.createElement('td');
        if (cells[i] === null) {
            cell.innerText = '-';
        } else if (cells[i] === undefined) {
        } else {
            if (cells[i] instanceof HTMLElement) {
                cell.appendChild(<HTMLElement>cells[i]);
            } else {
                cell.innerText = cells[i]?.toString();
            }
        }

        row.appendChild(cell);
    }

    return row;
}

function renderState(st: BankStateEnum) {
    switch (st) {
        case BankStateEnum.Precharging:
            return "Precharging (tRP)";
        case BankStateEnum.Refreshing:
            return "Refreshing (tRFC)";
        case BankStateEnum.Activating:
            return "Activating (tRCD)";
        default:
            return BankStateEnum[st];
    }
}

function renderIssueCheck(checks: [boolean, string][]) {
    if (!checks) {
        return undefined;
    }

    const container = document.createElement('div');
    for (let i = 0; i < checks.length; i++) {
        const check = document.createElement('div');
        if (checks[i][0]) {
            check.style.color = "darkgreen";
            check.innerText = '✓ ';
        } else {
            check.style.color = "darkred";
            check.innerText = '✗ ';
        }

        check.innerText += checks[i][1];
        container.appendChild(check);
    }

    return container;
}

function renderCommandQueue(cmds: MemCommand[]) {
    if (!cmds) {
        return undefined;
    }

    const container = document.createElement('div');
    for (let i = 0; i < cmds.length; i++) {
        const cmd = document.createElement('div');
        cmd.innerText = cmds[i].toString();
        container.appendChild(cmd);
    }

    return container;
}

function renderStateDumpBankGroup(bg: number) {
    const container = document.createElement('div');
    const title = document.createElement('p');
    title.innerText = `Bank Group ${bg}`;
    container.appendChild(title);

    bg <<= 2;
    const [table, tbody] = createTableWithHead('', 'Bank 0', 'Bank 1', 'Bank 2', 'Bank 3');
    const mc = getOrCreateController();
    tbody.appendChild(createTableRow(
        'State', renderState(mc.BankState[bg].State), renderState(mc.BankState[bg + 1].State),
        renderState(mc.BankState[bg + 2].State), renderState(mc.BankState[bg + 3].State),
    ));
    tbody.appendChild(createTableRow(
        'Cycles', mc.BankState[bg].StateCycles, mc.BankState[bg + 1].StateCycles,
        mc.BankState[bg + 2].StateCycles, mc.BankState[bg + 3].StateCycles,
    ));
    tbody.appendChild(createTableRow(
        'Open Row',
        toHex(mc.BankState[bg].CurrentOpenRow, 3), toHex(mc.BankState[bg + 1].CurrentOpenRow, 3),
        toHex(mc.BankState[bg + 2].CurrentOpenRow, 3), toHex(mc.BankState[bg + 3].CurrentOpenRow, 3),
    ));
    tbody.appendChild(createTableRow(
        'AP Engaged', mc.BankState[bg].WillPrecharge, mc.BankState[bg + 1].WillPrecharge,
        mc.BankState[bg + 2].WillPrecharge, mc.BankState[bg + 3].WillPrecharge,
    ));
    tbody.appendChild(createTableRow(
        'Active WRITEs', mc.BankState[bg].WriteTxs, mc.BankState[bg + 1].WriteTxs,
        mc.BankState[bg + 2].WriteTxs, mc.BankState[bg + 3].WriteTxs,
    ));
    tbody.appendChild(createTableRow(
        'Last ACT', mc.BankHistory[bg].SinceActivate, mc.BankHistory[bg + 1].SinceActivate,
        mc.BankHistory[bg + 2].SinceActivate, mc.BankHistory[bg + 3].SinceActivate,
    ));
    tbody.appendChild(createTableRow(
        'Last READ', mc.BankHistory[bg].SinceRead, mc.BankHistory[bg + 1].SinceRead,
        mc.BankHistory[bg + 2].SinceRead, mc.BankHistory[bg + 3].SinceRead,
    ));
    tbody.appendChild(createTableRow(
        'Last WRITE', mc.BankHistory[bg].SinceWrite, mc.BankHistory[bg + 1].SinceWrite,
        mc.BankHistory[bg + 2].SinceWrite, mc.BankHistory[bg + 3].SinceWrite,
    ));
    tbody.appendChild(createTableRow(
        'Last WRITE Tx', mc.BankHistory[bg].SinceWriteData, mc.BankHistory[bg + 1].SinceWriteData,
        mc.BankHistory[bg + 2].SinceWriteData, mc.BankHistory[bg + 3].SinceWriteData,
    ));
    tbody.appendChild(createTableRow(
        'Next Command', mc.BankCmdQueue[bg].CheckCmd?.toString(), mc.BankCmdQueue[bg + 1].CheckCmd?.toString(),
        mc.BankCmdQueue[bg + 2].CheckCmd?.toString(), mc.BankCmdQueue[bg + 3].CheckCmd?.toString(),
    ));
    tbody.appendChild(createTableRow(
        'Issue Check', renderIssueCheck(mc.BankCmdQueue[bg].CheckCmd && mc.BankCmdQueue[bg].IssueChecks),
        renderIssueCheck(mc.BankCmdQueue[bg + 1].CheckCmd && mc.BankCmdQueue[bg + 1].IssueChecks),
        renderIssueCheck(mc.BankCmdQueue[bg + 2].CheckCmd && mc.BankCmdQueue[bg + 2].IssueChecks),
        renderIssueCheck(mc.BankCmdQueue[bg + 3].CheckCmd && mc.BankCmdQueue[bg + 3].IssueChecks),
    ));
    tbody.appendChild(createTableRow(
        'Command Queue', renderCommandQueue(mc.BankCmdQueue[bg].AllCommand),
        renderCommandQueue(mc.BankCmdQueue[bg + 1].AllCommand),
        renderCommandQueue(mc.BankCmdQueue[bg + 2].AllCommand),
        renderCommandQueue(mc.BankCmdQueue[bg + 3].AllCommand),
    ));

    container.appendChild(table);
    return container;
}

function renderStateDumpRank(bgs: number) {
    const container = document.createElement('div');
    const title = document.createElement('p');
    title.innerText = `Rank Status`;
    container.appendChild(title);

    const headers = [''];
    for(let i = 0; i < bgs; i++) {
        headers.push(`Group ${i}`);
    }

    headers.push('Rank');
    const [table, tbody] = createTableWithHead(...headers);
    const mc = getOrCreateController();

    function gatherHistory(sel: (h: CommandHistory) => number) {
        const r = [];
        for (let i = 0; i < bgs; i++) {
            r.push(sel(mc.GroupHistory[i]));
        }

        r.push(sel(mc.RankHistory));
        return r;
    }

    tbody.appendChild(createTableRow(
        'ACT', ...gatherHistory(v => v.SinceActivate)
    ));
    tbody.appendChild(createTableRow(
        'READ', ...gatherHistory(v => v.SinceRead)
    ));
    tbody.appendChild(createTableRow(
        'WRITE', ...gatherHistory(v => v.SinceWrite)
    ));
    tbody.appendChild(createTableRow(
        'WRITE Tx', ...gatherHistory(v => v.SinceWriteData)
    ));

    container.appendChild(table);
    return container;
}

function renderStateDump() {
    const dumpRoot = $x('stateDump');
    while (dumpRoot.hasChildNodes())
        dumpRoot.removeChild(dumpRoot.childNodes[0]);

    const bgs = 1 << parseInt((<HTMLInputElement>$x('bgBits')).value);
    for (let i = 0; i < bgs; i++) {
        dumpRoot.appendChild(renderStateDumpBankGroup(i));
    }

    dumpRoot.appendChild(renderStateDumpRank(bgs));
}

function doCycles(cycles: number) {
    const mc = getOrCreateController();
    const allCycles = (<HTMLInputElement>$x('allCycles')).checked;
    let tableBody = $x('cycleTable');
    for (let i = 0; i < tableBody.childNodes.length; i++) {
        if ((<HTMLElement>tableBody.childNodes[i]).tagName === "TBODY") {
            tableBody = <HTMLElement>tableBody.childNodes[i];
            break;
        }
    }

    let outputDesCycle = true;
    for (let i = 0; i < cycles; i++) {
        while (mcCommands.length && mcCommands[0].Cycle === mc.CurrentCycle) {
            mc.EnqueueCommand(mcCommands.shift());
        }

        mc.DoCycle();
        outputDesCycle ||= mc.DqsActive;
        if (mc.CurrentCommand || mc.DqsActive || outputDesCycle || allCycles) {
            tableBody.appendChild(renderCycleRow());
        }

        outputDesCycle = !!(mc.CurrentCommand || mc.DqsActive);
    }

    renderStateDump();
}

$x('go').onclick = function () {
    doCycles(parseInt((<HTMLInputElement>$x('cycles')).value));
}

$x('step').onclick = function () {
    doCycles(1);
}

$x('reset').onclick = function() {
    mc = null;
    mcCommands = null;

    const cycleTable = $x('cycleTable');
    const tableBody = document.createElement('tbody');
    for (let i = 0; i < cycleTable.childNodes.length; i++) {
        if ((<HTMLElement>cycleTable.childNodes[i]).tagName === "THEAD") continue;
        cycleTable.removeChild(cycleTable.childNodes[i]);
        i--;
    }

    cycleTable.appendChild(tableBody);
    const dumpRoot = $x('stateDump');
    while (dumpRoot.hasChildNodes())
        dumpRoot.removeChild(dumpRoot.childNodes[0]);
}

loadState(JSON.parse(localStorage.getItem(stateKey)));
$x('bgBits').dispatchEvent(new Event("change"));
window.onunload = function() {
    localStorage.setItem(stateKey, JSON.stringify(saveState()));
}
