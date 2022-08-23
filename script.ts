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
    public Bank: number;
    public Group: number;
    public BankNum: number;
    public Address: number;
    public AutoPrecharge: boolean;
    public NotLatched: number;

    public constructor(cmd: MemCommandEnum, bg: number, ba: number, bank: number, addr: number) {
        this.Command = cmd;
        this.Bank = ba;
        this.Group = bg;
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
    private readonly tCR: number;
    private readonly commandCycleMap: Record<MemCommandEnum, number>;
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

    public constructor(tCR: number, commandCycleMap: Record<MemCommandEnum, number>) {
        this.tCR = tCR;
        this.commandCycleMap = commandCycleMap;
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

    public StateCheck(desc: string, currentState: BankStateEnum, ...allowedStates: BankStateEnum[]) {
        let pass = false;
        for (let i = 0; !pass && i < allowedStates.length; i++) {
            pass = currentState === allowedStates[i];
        }

        this.IssueCheck(pass, desc);
    }

    public TimingCheck(toCheck, target, name, desc) {
        let commandCycles = this.tCR * this.commandCycleMap[this.CheckCmd.Command];
        this.IssueCheck((toCheck + commandCycles) > target, `${desc}: ${toCheck} + ${commandCycles}(tCR) > ${target}(${name})`);
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

class AddressMapConfig {
    public readonly BG: number;
    public readonly BA: number;
    public readonly CA: number;
    public readonly BL: number;
    public readonly Banks: number;
    public readonly Groups: number;

    public constructor(bg: number, ba: number, ca: number, bl: number) {
        this.BG = bg;
        this.BA = ba;
        this.CA = ca;
        this.BL = bl;
        this.Groups = 1 << bg;
        this.Banks = this.Groups * (1 << ba);
    }
}

class MemoryController {
    private readonly tCL: number;
    private readonly tCWL: number;
    private readonly tRCDrd: number;
    private readonly tRCDwr: number;
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
    private readonly tWRa: number;
    private readonly tRTPa: number;
    private readonly tRdWrSg: number;
    private readonly tRdWrDg: number;
    private readonly tRdRdSg: number;
    private readonly tRdRdDg: number;
    private readonly tWrWrSg: number;
    private readonly tWrWrDg: number;
    private readonly tREFI: number;
    private readonly tRFC: number;
    private readonly tRPRE: number;
    private readonly tWPRE: number;
    private readonly tCR: number;
    private readonly gearDown: boolean;
    private readonly commandCycleMap: Record<MemCommandEnum, number>;
    public readonly AddrCfg: AddressMapConfig;

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

    get CommandRate(): number { return this.tCR; }
    get CurrentCycle(): number { return this.currentCycle; }
    get CurrentCommand(): MemCommand { return this.currentCommand; }
    get DqsActive(): boolean { return this.dqsActive; }
    get DqActive(): [MemCommandEnum, number, number, number, number] { return this.dqActive; }

    public constructor(tCL: number, tCWL: number, tRCDrd: number, tRCDwr: number, tRP: number, tRAS: number, tRC: number,
                       tRRDs: number, tRRDl: number, tFAW: number, tWTRs: number, tWTRl: number,
                       tWR: number, tRTP: number, tWRa: number, tRTPa: number, tRdWrSg: number, tRdWrDg: number,
                       tRdRdSg: number, tRdRdDg: number, tWrWrSg: number, tWrWrDg: number,
                       tREFI: number, tRFC: number, tCR: number, gdm: boolean, addrCfg: AddressMapConfig,
                       commandCycleMap?: Partial<Record<MemCommandEnum, number>>) {
        this.tCL = tCL;
        this.tCWL = tCWL;
        this.tRCDrd = tRCDrd;
        this.tRCDwr = tRCDwr;
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
        this.tWRa = tWRa;
        this.tRTPa = tRTPa;
        this.tRdWrSg = tRdWrSg;
        this.tRdWrDg = tRdWrDg;
        this.tRdRdSg = tRdRdSg;
        this.tRdRdDg = tRdRdDg;
        this.tWrWrSg = tWrWrSg;
        this.tWrWrDg = tWrWrDg;
        this.tREFI = tREFI;
        this.tRFC = tRFC;
        this.AddrCfg = addrCfg;
        this.tRPRE = 1;
        this.tWPRE = 1;
        this.tCR = tCR;
        this.gearDown = gdm;

        commandCycleMap ??= {};
        this.commandCycleMap = {
            [MemCommandEnum.PRE]: commandCycleMap[MemCommandEnum.PRE] ?? 1,
            [MemCommandEnum.ACT]: commandCycleMap[MemCommandEnum.ACT] ?? 1,
            [MemCommandEnum.REF]: commandCycleMap[MemCommandEnum.REF] ?? 1,
            [MemCommandEnum.READ]: commandCycleMap[MemCommandEnum.READ] ?? 1,
            [MemCommandEnum.WRITE]: commandCycleMap[MemCommandEnum.WRITE] ?? 1
        };

        this.currentCycle = 0;
        this.currentCommand = null;
        this.sinceRefresh = 0;
        this.fawTracking = [];
        this.imcCommandQueue = [];
        this.dqsSchedule = [];
        this.RankHistory = new CommandHistory();

        this.GroupHistory = [];
        for (let i = 0; i < addrCfg.Groups; i++) {
            this.GroupHistory.push(new CommandHistory());
        }

        this.BankCmdQueue = [];
        this.BankHistory = [];
        this.BankState = [];
        for (let i = 0; i < addrCfg.Banks; i++) {
            this.BankCmdQueue.push(new CommandQueue(tCR, this.commandCycleMap));
            this.BankHistory.push(new CommandHistory());
            this.BankState.push(new BankState());
        }
    }

    public EnqueueCommand(cmd: ImcCommand): void {
        this.imcCommandQueue.push(cmd);
    }

    private maybeEnqueueRefresh(): void {
        if (this.BankCmdQueue.every(q => q.Empty) && this.BankState.every(q => q.State !== BankStateEnum.Refreshing)) {
            const preCommand = new MemCommand(MemCommandEnum.PRE, 0, 0, 0, 0);
            preCommand.AutoPrecharge = true;
            const refreshCommand = new MemCommand(MemCommandEnum.REF, 0, 0, 0, 0);

            if (!this.BankCmdQueue.every(q => q.OpenRow === null)) {
                this.BankCmdQueue.forEach(q => q.QueueCommand(preCommand));
            }

            this.BankCmdQueue.forEach(q => q.QueueCommand(refreshCommand));
        }
    }

    private scheduleDqs(cmd: MemCommand, dryRun: boolean): [boolean, number, number] {
        const delay = ((cmd.Command === MemCommandEnum.READ) ? this.tCL : this.tCWL) + (this.tCR * this.commandCycleMap[cmd.Command]) - 1;
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

        let totalCycles = 1 << (this.AddrCfg.BL - 1);
        let preamble = (cmd.Command === MemCommandEnum.READ) ? this.tRPRE : this.tWPRE;
        let nextPreamble = (nextDqs && (nextDqs.Command.Command === MemCommandEnum.READ)) ? this.tRPRE : this.tWPRE;

        let nextDqsDue = nextDqs ? nextDqs.DueCycles : delay + totalCycles + 1 + nextPreamble;
        let prevDqsEnd = prevDqs ? prevDqs.DueCycles + totalCycles : delay - 1 - preamble;

        needsPreGap ||= prevDqs && prevDqs.Command.Command !== cmd.Command;
        needsPreamble ||= prevDqsEnd !== delay;
        needsPreamble ||= needsPreGap;

        nextNeedsPreGap ||= nextDqs && nextDqs.Command.Command !== cmd.Command;
        nextNeedsPreamble ||= nextDqsDue - totalCycles !== delay;
        nextNeedsPreamble ||= nextNeedsPreGap;

        if (needsPreGap) totalCycles++;
        if (needsPreamble) totalCycles += preamble;
        if (nextNeedsPreGap) totalCycles++;
        if (nextNeedsPreamble) totalCycles += nextPreamble;

        if ((nextDqsDue - prevDqsEnd) < totalCycles)
            return [false, totalCycles, delay];

        if (!dryRun) {
            if (nextDqs)
                nextDqs.Preamble = nextNeedsPreamble ? nextPreamble : 0;

            this.dqsSchedule.splice(i, 0,
                new DqsSchedule(delay, this.BankState[cmd.BankNum].CurrentOpenRow, cmd, needsPreamble ? preamble : 0));
        }

        return [true, totalCycles, delay];
    }

    private issuePrechargeAllBanks() {
        const preA = new MemCommand(MemCommandEnum.PRE, 0, 0, 0, 0);
        preA.AutoPrecharge = true;
        this.issueCommand(preA);
    }

    private issueRefresh() {
        this.issueCommand(new MemCommand(MemCommandEnum.REF, 0, 0, 0, 0));
    }

    private issueCommand(cmd: MemCommand) {
        const bankState = this.BankState[cmd.BankNum];
        const bankHistory = this.BankHistory[cmd.BankNum];
        const groupHistory = this.GroupHistory[cmd.Group];
        const commandCycles = this.tCR * this.commandCycleMap[cmd.Command];

        cmd.NotLatched = commandCycles - 1;
        this.currentCommand = cmd;

        switch (cmd.Command) {
            case MemCommandEnum.REF:
                this.sinceRefresh -= this.tREFI;
                for (let i = 0; i < this.AddrCfg.Banks; i++) {
                    this.BankState[i].State = BankStateEnum.Refreshing;
                    this.BankState[i].StateCycles = 1 - commandCycles;
                }
                break;
            case MemCommandEnum.PRE:
                if (!cmd.AutoPrecharge) {
                    bankState.State = BankStateEnum.Precharging;
                    bankState.StateCycles = 1 - commandCycles;
                    bankState.CurrentOpenRow = null;
                } else {
                    for (let i = 0; i < this.AddrCfg.Banks; i++) {
                        if (this.BankState[i].State === BankStateEnum.Active && !this.BankState[i].WriteTxs) {
                            this.BankState[i].State = BankStateEnum.Precharging;
                            this.BankState[i].StateCycles = 1 - commandCycles;
                            this.BankState[i].CurrentOpenRow = null;
                        }
                    }
                }
                break;
            case MemCommandEnum.ACT:
                bankState.State = BankStateEnum.Activating;
                bankState.StateCycles = 1 - commandCycles;
                bankState.CurrentOpenRow = cmd.Address;
                bankHistory.SinceActivate = 1 - commandCycles;
                groupHistory.SinceActivate = 1 - commandCycles;
                this.RankHistory.SinceActivate = 1 - commandCycles;
                this.fawTracking.push(0);
                break;
            case MemCommandEnum.READ:
                bankState.WillPrecharge = cmd.AutoPrecharge;
                bankHistory.SinceRead = 1 - commandCycles;
                groupHistory.SinceRead = 1 - commandCycles;
                this.RankHistory.SinceRead = 1 - commandCycles;
                this.scheduleDqs(cmd, false);
                break;
            case MemCommandEnum.WRITE:
                bankState.WillPrecharge = cmd.AutoPrecharge;
                bankState.WriteTxs++;
                bankHistory.SinceWrite = 1 - commandCycles;
                groupHistory.SinceWrite = 1 - commandCycles;
                this.RankHistory.SinceWrite = 1 - commandCycles;
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

        for (let i = 0; i < this.AddrCfg.Banks; i++) {
            const bankState = this.BankState[i];
            const bankHistory = this.BankHistory[i];

            switch (bankState.State) {
                case BankStateEnum.Idle:
                    break;
                case BankStateEnum.Activating:
                    if (bankState.StateCycles + this.tCR > Math.max(this.tRCDrd, this.tRCDwr)) {
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
                        bankState.WillPrecharge = false;
                    }
                    break;
                case BankStateEnum.Active:
                    if (bankState.WillPrecharge &&
                        !bankState.WriteTxs &&
                        bankHistory.SinceRead + this.tCR > this.tRTPa &&
                        bankHistory.SinceWriteData + this.tCR > this.tWRa &&
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
                const [group, bank, row, column] = MemoryController.MapAddress(imcCommand.Address, this.AddrCfg);
                const bankNum = (group << this.AddrCfg.BA) | bank;
                const bankQueue = this.BankCmdQueue[bankNum];

                if (bankQueue.OpenRow !== row) {
                    if (bankQueue.OpenRow !== null)
                        bankQueue.QueueCommand(new MemCommand(MemCommandEnum.PRE, group, bank, bankNum, 0));

                    bankQueue.QueueCommand(new MemCommand(MemCommandEnum.ACT, group, bank, bankNum, row));
                }

                bankQueue.QueueCommand(new MemCommand(imcCommand.IsWrite ? MemCommandEnum.WRITE : MemCommandEnum.READ, group, bank, bankNum, column));
            } else if (this.sinceRefresh >= (-4 * this.tREFI)) {
                this.maybeEnqueueRefresh();
            }
        } else {
            this.maybeEnqueueRefresh();
        }

        for (let i = 0; i < this.AddrCfg.Banks; i++) {
            const bankQueue = this.BankCmdQueue[i];
            const bankState = this.BankState[i];
            const bankHistory = this.BankHistory[i];
            const groupHistory = this.GroupHistory[i >> this.AddrCfg.BA];
            let dqsSchedule;

            bankQueue.StartIssueCheck();
            bankQueue.IssueCheck(this.currentCommand === null, "C/A bus available");
            if (this.gearDown) {
                bankQueue.IssueCheck((this.tCR & 1) == (this.currentCycle & 1), "Gear-Down Command Cycle");
            }

            if (!bankQueue.Empty) {
                const cmd = bankQueue.FirstCommand;
                switch(cmd.Command) {
                    case MemCommandEnum.ACT:
                        bankQueue.StateCheck("Bank idle", bankState.State, BankStateEnum.Idle);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRC, "tRC", "Since ACT in bank");
                        bankQueue.TimingCheck(groupHistory.SinceActivate, this.tRRDl, "tRRD_L", "Since ACT in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceActivate, this.tRRDs, "tRRD_S", "Since ACT in rank");
                        bankQueue.IssueCheck(this.fawTracking.length < 4, `ACTs in rank in tFAW: [${this.fawTracking.join(', ')}]`);
                        break;
                    case MemCommandEnum.REF:
                        bankQueue.StateCheck("Bank idle", bankState.State, BankStateEnum.Idle);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRC, "tRC", "Since ACT in bank");
                        break;
                    case MemCommandEnum.PRE:
                        if (cmd.AutoPrecharge) {
                            bankQueue.StateCheck("PreA: Bank active or idle", bankState.State,
                                BankStateEnum.Active, BankStateEnum.Activating, BankStateEnum.Precharging, BankStateEnum.Idle);
                        } else {
                            bankQueue.StateCheck("Bank active", bankState.State, BankStateEnum.Active, BankStateEnum.Activating);
                        }

                        bankQueue.IssueCheck(!bankState.WriteTxs, `In-flight WRITEs: ${bankState.WriteTxs}`);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRAS, "tRAS", "Since ACT");
                        bankQueue.TimingCheck(bankHistory.SinceRead, this.tRTP, "tRTP", "Since READ");
                        bankQueue.TimingCheck(bankHistory.SinceWriteData, this.tWR, "tWR", "Since WRITE Tx");
                        break;
                    case MemCommandEnum.READ:
                        bankQueue.StateCheck("Bank active", bankState.State, BankStateEnum.Active, BankStateEnum.Activating);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRCDrd, "tRCDrd", "Since bank ACT");
                        bankQueue.IssueCheck(!bankState.WriteTxs, `In-flight WRITEs: ${bankState.WriteTxs}`);

                        bankQueue.TimingCheck(groupHistory.SinceRead, this.tRdRdSg, "tRdRd_sg/tRdRdScL", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWriteData, this.tWTRl, "tWTR_L", "Since WRITE Tx in group");

                        bankQueue.TimingCheck(this.RankHistory.SinceRead, this.tRdRdDg, "tRdRd_dg/tRdRdSc", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWriteData, this.tWTRs, "tWTR_S", "Since WRITE Tx in rank");

                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], `DQS available for ${dqsSchedule[1]} cycles after ${dqsSchedule[2]} cycles`);
                        break;
                    case MemCommandEnum.WRITE:
                        bankQueue.StateCheck("Bank active", bankState.State, BankStateEnum.Active, BankStateEnum.Activating);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRCDwr, "tRCDwr", "Since bank ACT");

                        bankQueue.TimingCheck(groupHistory.SinceRead, this.tRdWrSg, "tRdWr_sg", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWrite, this.tWrWrSg, "tWrWr_sg/tWrWrScL", "Since WRITE in group");

                        bankQueue.TimingCheck(this.RankHistory.SinceRead, this.tRdWrDg, "tRdWr_dg", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWrite, this.tWrWrDg, "tWrWr_dg/tWrWrSc", "Since WRITE in rank");

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
            for (let i = 0; i < this.AddrCfg.Banks; i++) {
                const bankNum = ((i + (this.currentCycle >> this.AddrCfg.BA)) & ((1 << this.AddrCfg.BG) - 1)) << this.AddrCfg.BA;
                const bankHistory = this.BankHistory[bankNum];
                const bankQueue = this.BankCmdQueue[bankNum];
                if (!bankQueue.CanIssue) continue;

                const cmd = bankQueue.FirstCommand;
                if (cmd.Command === MemCommandEnum.PRE && cmd.AutoPrecharge) continue;
                if (cmd.Command === MemCommandEnum.REF) continue;
                bankQueue.DequeueCommand();

                let canAutoPrecharge = cmd.Command === MemCommandEnum.READ || cmd.Command === MemCommandEnum.WRITE;
                canAutoPrecharge &&= bankQueue.FirstCommand?.Command === MemCommandEnum.PRE && !bankQueue.FirstCommand.AutoPrecharge;

                if (cmd.Command === MemCommandEnum.READ) {
                    const tWTRa = this.tWR - this.tRTP;
                    canAutoPrecharge &&= bankHistory.SinceWriteData + this.tCR * this.commandCycleMap[MemCommandEnum.READ] > tWTRa;
                    canAutoPrecharge &&= this.tRTPa === this.tRTP;
                }

                if (cmd.Command === MemCommandEnum.WRITE) {
                    canAutoPrecharge &&= this.tWRa === this.tWR;
                }

                if (canAutoPrecharge) {
                    cmd.AutoPrecharge = true;
                    bankQueue.DequeueCommand();
                }

                this.issueCommand(cmd);
                break;
            }
        }

        this.dqActive = null;
        this.dqsActive = false;

        if (this.dqsSchedule.length) {
            let dqs = this.dqsSchedule[0];
            if (dqs.DueCycles === -((1 << (this.AddrCfg.BL - 1)) - 1)) {
                this.dqsSchedule.shift();
                if (dqs.Command.Command === MemCommandEnum.WRITE) {
                    this.BankState[dqs.Command.BankNum].WriteTxs--;
                    this.BankHistory[dqs.Command.BankNum].SinceWriteData = -1;
                    this.GroupHistory[dqs.Command.Group].SinceWriteData = -1;
                    this.RankHistory.SinceWriteData = -1;
                }
            }

            if (dqs.DueCycles <= 0) {
                this.dqActive = [dqs.Command.Command, dqs.Command.Group, dqs.Command.Bank, dqs.RowNumber, dqs.Command.Address - dqs.DueCycles * 2];
                this.dqsActive = true;
            } else {
                this.dqsActive = dqs.Preamble >= dqs.DueCycles;
            }
        }
    }

    public static MapAddress(addr: number, addrCfg: AddressMapConfig) : [number, number, number, number] {
        let bgBits = addrCfg.BG;
        addr >>>= addrCfg.BL;
        let group = 0;
        if (bgBits) {
            group = addr & 1;
            bgBits--;
            addr >>>= 1;
        }
        const column = (addr & ((1 << (addrCfg.CA - addrCfg.BL)) - 1)) << addrCfg.BL;
        addr >>>= addrCfg.CA - addrCfg.BL;
        if (bgBits) {
            group |= (addr & 1) << 1;
            bgBits--;
            addr >>>= 1;
        }
        const bank = addr & ((1 << addrCfg.BA) - 1);
        addr >>>= addrCfg.BA;
        if (bgBits) {
            group |= (addr & ((1 << bgBits) - 1)) << 2;
            addr >>>= bgBits;
        }
        const row = addr;

        return [group, bank, row, column];
    }

    public MapMemArray(mem: [number, number, number, number]) : number {
        let addr = mem[2];
        if (this.AddrCfg.BG > 2) {
            addr <<= this.AddrCfg.BG - 2;
            addr |= mem[0] >>> 2;
        }
        addr <<= this.AddrCfg.BA;
        addr |= mem[1];
        if (this.AddrCfg.BG > 1) {
            addr <<= 1;
            addr |= (mem[0] >>> 1) & 1;
        }
        addr <<= this.AddrCfg.CA - this.AddrCfg.BL;
        addr |= mem[3] >>> this.AddrCfg.BL;
        if (this.AddrCfg.BG > 0) {
            addr <<= 1;
            addr |= mem[0] & 1;
        }

        addr <<= this.AddrCfg.BL;
        addr |= mem[3] & ((1 << this.AddrCfg.BL) - 1);
        return addr;
    }
}

function $x(e) { return document.getElementById(e); }
function toHex(v: number, len: number): string {
    if (v === null) return null;
    if (v === undefined) return undefined;

    let s = v.toString(16).toUpperCase();
    while (s.length < len) s = '0' + s;
    return s;
}

function getAddrMapConfig() {
    return new AddressMapConfig(
        parseInt((<HTMLInputElement>$x('bgBits')).value),
        parseInt((<HTMLInputElement>$x('baBits')).value),
        parseInt((<HTMLInputElement>$x('caBits')).value),
        parseInt((<HTMLInputElement>$x('blBits')).value),
    );
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
        const [bankGroup, bank, aRow, col] = MemoryController.MapAddress(addr, getAddrMapConfig());
        mapAddrCell.innerText = `${bankGroup}/${bank}/${toHex(aRow, 5)}/${toHex(col, 3)}`;

        if (!row.isConnected) {
            $x('blBits').removeEventListener('change', updateMapAddr);
            $x('bgBits').removeEventListener('change', updateMapAddr);
            $x('baBits').removeEventListener('change', updateMapAddr);
            $x('caBits').removeEventListener('change', updateMapAddr);
        }
    }

    addrInput.onkeyup = updateMapAddr;
    $x('blBits').addEventListener('change', updateMapAddr);
    $x('bgBits').addEventListener('change', updateMapAddr);
    $x('baBits').addEventListener('change', updateMapAddr);
    $x('caBits').addEventListener('change', updateMapAddr);

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
    'tRCDrd',
    'tRCDwr',
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
    'tRdWrSg',
    'tRdWrDg',
    'tRdRdSg',
    'tRdRdDg',
    'tWrWrSg',
    'tWrWrDg',
    'tREFI',
    'tRFC',
    'tCR',
    'ddr5',
    'gearDown',
    'bgBits',
    'baBits',
    'caBits',
    'blBits',
    'cycles',
    'allCycles',
    'useAP',
    'collapseNotes'
];

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
                ai.value = toHex(cmd.Address ?? 0, 9);
            }
        }
    } else {
        addCmdRow();
    }
}

let mc: MemoryController;
let memClock: number;
let mcUseDdr5: boolean;
let mcCommands: ImcCommand[];

function createController() {
    let commandCycleMap: Partial<Record<MemCommandEnum, number>> = {};
    mcUseDdr5 = (<HTMLInputElement>$x('ddr5')).checked;
    if (mcUseDdr5) {
        commandCycleMap[MemCommandEnum.ACT] = 2;
        commandCycleMap[MemCommandEnum.READ] = 2;
        commandCycleMap[MemCommandEnum.WRITE] = 2;
    }

    const tWR = parseInt((<HTMLInputElement>$x('tWR')).value);
    const tRTP = parseInt((<HTMLInputElement>$x('tRTP')).value);
    let tWRa, tRTPa;
    if (mcUseDdr5) {
        commandCycleMap[MemCommandEnum.ACT] = 2;
        commandCycleMap[MemCommandEnum.READ] = 2;
        commandCycleMap[MemCommandEnum.WRITE] = 2;
        if (tRTP <= 12) {
            tRTPa = 12;
        } else if (tRTP >= 24) {
            tRTPa = 24;
        } else {
            tRTPa = Math.ceil(Math.ceil(tRTP / 1.5) * 1.5);
        }

        if (tWR <= 48) {
            tWRa = 48;
        } else if (tWR >= 96) {
            tWRa = 96;
        } else {
            tWRa = Math.ceil(tWR / 6) * 6;
        }
    } else {
        if (tRTP <= 5) {
            tRTPa = 5;
        } else if (tRTP >= 14) {
            tRTPa = 14;
        } else {
            tRTPa = tRTP;
        }

        tWRa = tRTPa * 2;
    }

    if (!(<HTMLInputElement>$x('useAP')).checked) {
        tWRa = tRTPa = null;
    }

    mcCommands = getImcCommands();
    mc = new MemoryController(
        parseInt((<HTMLInputElement>$x('tCL')).value),
        parseInt((<HTMLInputElement>$x('tCWL')).value),
        parseInt((<HTMLInputElement>$x('tRCDrd')).value),
        parseInt((<HTMLInputElement>$x('tRCDwr')).value),
        parseInt((<HTMLInputElement>$x('tRP')).value),
        parseInt((<HTMLInputElement>$x('tRAS')).value),
        parseInt((<HTMLInputElement>$x('tRC')).value),
        parseInt((<HTMLInputElement>$x('tRRDs')).value),
        parseInt((<HTMLInputElement>$x('tRRDl')).value),
        parseInt((<HTMLInputElement>$x('tFAW')).value),
        parseInt((<HTMLInputElement>$x('tWTRs')).value),
        parseInt((<HTMLInputElement>$x('tWTRl')).value),
        tWR, tRTP, tWRa, tRTPa,
        parseInt((<HTMLInputElement>$x('tRdWrSg')).value),
        parseInt((<HTMLInputElement>$x('tRdWrDg')).value),
        parseInt((<HTMLInputElement>$x('tRdRdSg')).value),
        parseInt((<HTMLInputElement>$x('tRdRdDg')).value),
        parseInt((<HTMLInputElement>$x('tWrWrSg')).value),
        parseInt((<HTMLInputElement>$x('tWrWrDg')).value),
        parseInt((<HTMLInputElement>$x('tREFI')).value),
        parseInt((<HTMLInputElement>$x('tRFC')).value),
        parseInt((<HTMLInputElement>$x('tCR')).value),
        (<HTMLInputElement>$x('gearDown')).checked,
        getAddrMapConfig(),
        commandCycleMap
    );

    memClock = parseInt((<HTMLInputElement>$x('memTxSpeed')).value);
    const mcString = (memClock * 3).toString();
    if (mcString.match(/98$/)) {
        memClock += 2 / 3;
    } else if (mcString.match(/99$/)) {
        memClock += 1 / 3;
    } else if (mcString.match(/01$/)) {
        memClock -= 1 / 3;
    }

    memClock /= 2;
    return mc;
}

function getOrCreateController() {
    return mc ??= createController();
}

function renderCycleRow() {
    const row = document.createElement('tr');
    let cell = document.createElement('td');
    cell.innerText = (1000 * mc.CurrentCycle / memClock).toFixed(1);
    row.appendChild(cell);

    cell = document.createElement('td');
    cell.innerText = mc.CurrentCycle.toString();
    row.appendChild(cell);

    if (mc.CurrentCommand) {
        const cmd = mc.CurrentCommand;
        const cmdClass = cmd.NotLatched ? 'latching' : 'active';

        // Command
        cell = document.createElement('td');
        switch (cmd.Command) {
            case MemCommandEnum.READ: cell.innerHTML = "Read"; break;
            case MemCommandEnum.WRITE: cell.innerHTML = "Write"; break;
            case MemCommandEnum.ACT: cell.innerHTML = "Activate"; break;
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
        cell.innerText = `${cmd.Group}/${cmd.Bank}`;
        switch (cmd.Command) {
            case MemCommandEnum.REF: cell.innerText = "All"; break;
            case MemCommandEnum.PRE: if (cmd.AutoPrecharge) cell.innerText = "All"; break;
        }
        row.appendChild(cell);

        // CS
        cell = document.createElement('td');
        if (mcUseDdr5) {
            let cmdCycles = 1;
            switch (cmd.Command) {
                case MemCommandEnum.ACT:
                case MemCommandEnum.READ:
                case MemCommandEnum.WRITE:
                    cmdCycles = 2;
                    break;
            }

            if ((mc.CommandRate + cmd.NotLatched) < (cmdCycles * mc.CommandRate)) {
                cell.className =  'logF';
                cell.innerText = `H`;
            } else {
                cell.className =  'logT';
                cell.innerText = `L`;
            }
        } else {
            cell.className = cmd.NotLatched ? 'logF' : 'logT';
            cell.innerText = cmd.NotLatched ? 'H' : 'L';
        }
        row.appendChild(cell);

        switch (cmd.Command) {
            case MemCommandEnum.ACT:
                // RAS/CAS/WE
                cell = document.createElement('td');
                cell.innerText = `L`;
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = `H`;
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = `H`;
                cell.className = 'logF';
                row.appendChild(cell);

                // Address
                cell = document.createElement('td');
                cell.innerText = `${toHex(cmd.Address, 5)}`;
                cell.className = cmdClass;
                cell.colSpan = 2;
                row.appendChild(cell);
                break;
            case MemCommandEnum.READ:
            case MemCommandEnum.WRITE:
                // RAS/CAS/WE
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

                // AP
                cell = document.createElement('td');
                cell.innerText = cmd.AutoPrecharge ? `H` : 'L';
                cell.className = cmd.AutoPrecharge ? `logT` : 'logF';
                row.appendChild(cell);

                // Address
                cell = document.createElement('td');
                cell.innerText = `${toHex(cmd.Address, 3)}`;
                cell.className = cmdClass;
                row.appendChild(cell);
                break;
            case MemCommandEnum.PRE:
                // RAS/CAS/WE
                cell = document.createElement('td');
                cell.innerText = `L`;
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = `H`;
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = `L`;
                cell.className = 'logT';
                row.appendChild(cell);

                // AP
                cell = document.createElement('td');
                cell.innerText = cmd.AutoPrecharge ? `H` : 'L';
                cell.className = cmd.AutoPrecharge ? `logT` : 'logF';
                row.appendChild(cell);

                // Address
                cell = document.createElement('td');
                cell.innerText = `-`;
                cell.className = cmdClass;
                row.appendChild(cell);
                break;
            case MemCommandEnum.REF:
                // RAS/CAS/WE
                cell = document.createElement('td');
                cell.innerText = `L`;
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = `L`;
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = `H`;
                cell.className = 'logF';
                row.appendChild(cell);

                // Address
                cell = document.createElement('td');
                cell.innerText = `-`;
                cell.className = cmdClass;
                cell.colSpan = 2;
                row.appendChild(cell);
                break;
        }
    } else {
        cell = document.createElement('td');
        cell.colSpan = 8;
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
    if (mc.DqActive) {
        dq[0] = (mc.DqActive && mc.DqActive[0] === MemCommandEnum.READ) ? 'R' : 'W';
        // @ts-ignore
        dq[1] = toHex(mc.MapMemArray(mc.DqActive.slice(1)), 9);
    }
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
        if (i === 9 && cmds.length > 10) {
            cmd.innerText = `... (+${cmds.length - i})`;
            container.appendChild(cmd);
            break;
        }

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

    const mc = getOrCreateController();
    const bas = 1 << mc.AddrCfg.BA;
    bg <<= mc.AddrCfg.BA;
    const headers = [''];
    for(let i = 0; i < bas; i++) {
        headers.push(`Bank ${i}`);
    }

    function gatherData(sel: (mc: MemoryController, bn: number) => string | HTMLElement | {toString(): string}) {
        const r = [];
        for (let i = 0; i < bas; i++) {
            r.push(sel(mc, bg + i));
        }

        return r;
    }

    const [table, tbody] = createTableWithHead(...headers);
    tbody.appendChild(createTableRow(
        'State', ...gatherData((mc, bg) => renderState(mc.BankState[bg].State)),
    ));
    tbody.appendChild(createTableRow(
        'Cycles', ...gatherData((mc, bg) => mc.BankState[bg].StateCycles),
        ));
    tbody.appendChild(createTableRow(
        'Open Row', ...gatherData((mc, bg) => toHex(mc.BankState[bg].CurrentOpenRow, 5)),
    ));
    tbody.appendChild(createTableRow(
        'AP Engaged', ...gatherData((mc, bg) => mc.BankState[bg].WillPrecharge),
    ));
    tbody.appendChild(createTableRow(
        'Active WRITEs', ...gatherData((mc, bg) => mc.BankState[bg].WriteTxs),
    ));
    tbody.appendChild(createTableRow(
        'Last ACT', ...gatherData((mc, bg) => mc.BankHistory[bg].SinceActivate),
    ));
    tbody.appendChild(createTableRow(
        'Last READ', ...gatherData((mc, bg) => mc.BankHistory[bg].SinceRead),
    ));
    tbody.appendChild(createTableRow(
        'Last WRITE', ...gatherData((mc, bg) => mc.BankHistory[bg].SinceWrite),
    ));
    tbody.appendChild(createTableRow(
        'Last WRITE Tx', ...gatherData((mc, bg) => mc.BankHistory[bg].SinceWriteData),
    ));
    tbody.appendChild(createTableRow(
        'Next Command', ...gatherData((mc, bg) => mc.BankCmdQueue[bg].CheckCmd),
    ));
    tbody.appendChild(createTableRow(
        'Issue Check', ...gatherData((mc, bg) => renderIssueCheck(mc.BankCmdQueue[bg].CheckCmd && mc.BankCmdQueue[bg].IssueChecks)),
    ));
    tbody.appendChild(createTableRow(
        'Command Queue', ...gatherData((mc, bg) => renderCommandQueue(mc.BankCmdQueue[bg].AllCommand))
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

    const mc = getOrCreateController();
    const bgs = 1 << mc.AddrCfg.BG;
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
    let cycleTableContainer = tableBody.parentElement;
    while (!cycleTableContainer.className) cycleTableContainer = cycleTableContainer.parentElement;
    cycleTableContainer.scrollTo({top: cycleTableContainer.scrollHeight});
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
