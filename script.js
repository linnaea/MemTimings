var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var BankStateEnum;
(function (BankStateEnum) {
    BankStateEnum[BankStateEnum["Idle"] = 0] = "Idle";
    BankStateEnum[BankStateEnum["Refreshing"] = 1] = "Refreshing";
    BankStateEnum[BankStateEnum["Activating"] = 2] = "Activating";
    BankStateEnum[BankStateEnum["Active"] = 3] = "Active";
    BankStateEnum[BankStateEnum["Precharging"] = 4] = "Precharging";
})(BankStateEnum || (BankStateEnum = {}));
var MemCommandEnum;
(function (MemCommandEnum) {
    MemCommandEnum[MemCommandEnum["REF"] = 0] = "REF";
    MemCommandEnum[MemCommandEnum["ACT"] = 1] = "ACT";
    MemCommandEnum[MemCommandEnum["PRE"] = 2] = "PRE";
    MemCommandEnum[MemCommandEnum["READ"] = 3] = "READ";
    MemCommandEnum[MemCommandEnum["WRITE"] = 4] = "WRITE";
})(MemCommandEnum || (MemCommandEnum = {}));
var MemCommand = /** @class */ (function () {
    function MemCommand(cmd, bank, addr) {
        this.Command = cmd;
        this.BankNum = bank;
        this.Address = addr;
        this.AutoPrecharge = false;
    }
    Object.defineProperty(MemCommand.prototype, "BankGroup", {
        get: function () {
            return this.BankNum >> 2;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(MemCommand.prototype, "Bank", {
        get: function () {
            return this.BankNum & 3;
        },
        enumerable: false,
        configurable: true
    });
    MemCommand.prototype.toString = function () {
        var cmd;
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
                return "ACT ".concat(toHex(this.Address, 5));
        }
        if (this.AutoPrecharge)
            cmd += "/A";
        if (this.Command === MemCommandEnum.PRE)
            return cmd;
        cmd += ' ';
        cmd += toHex(this.Address, 3);
        return cmd;
    };
    return MemCommand;
}());
var BankState = /** @class */ (function () {
    function BankState() {
        this.State = BankStateEnum.Idle;
        this.StateCycles = 65535;
        this.CurrentOpenRow = null;
        this.WriteTxs = 0;
        this.WillPrecharge = false;
    }
    BankState.prototype.doCycle = function () {
        if (this.State === BankStateEnum.Idle)
            return;
        if (this.State === BankStateEnum.Active)
            return;
        if (this.StateCycles < 65535)
            this.StateCycles++;
    };
    return BankState;
}());
var CommandQueue = /** @class */ (function () {
    function CommandQueue(tCR, commandCycleMap) {
        this.tCR = tCR;
        this.commandCycleMap = commandCycleMap;
        this.queue = [];
        this.openRow = null;
        this.StartIssueCheck();
    }
    Object.defineProperty(CommandQueue.prototype, "Empty", {
        get: function () { return !this.queue.length; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CommandQueue.prototype, "OpenRow", {
        get: function () { return this.openRow; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CommandQueue.prototype, "FirstCommand", {
        get: function () { return this.queue[0]; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CommandQueue.prototype, "AllCommand", {
        get: function () { return this.queue.slice(0); },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(CommandQueue.prototype, "CanIssue", {
        get: function () { return this.canIssue; },
        enumerable: false,
        configurable: true
    });
    CommandQueue.prototype.DequeueCommand = function () { return this.queue.shift(); };
    CommandQueue.prototype.QueueCommand = function (cmd) {
        this.queue.push(cmd);
        switch (cmd.Command) {
            case MemCommandEnum.PRE:
                this.openRow = null;
                break;
            case MemCommandEnum.ACT:
                this.openRow = cmd.Address;
                break;
        }
    };
    CommandQueue.prototype.StartIssueCheck = function () {
        this.CheckCmd = this.FirstCommand;
        this.canIssue = !this.Empty;
        this.IssueChecks = [];
    };
    CommandQueue.prototype.IssueCheck = function (pass, desc) {
        this.IssueChecks.push([pass, desc]);
        this.canIssue = pass && this.canIssue;
    };
    CommandQueue.prototype.TimingCheck = function (toCheck, target, name, desc) {
        var commandCycles = this.tCR * this.commandCycleMap[this.CheckCmd.Command];
        this.IssueCheck((toCheck + commandCycles) > target, "".concat(desc, ": ").concat(toCheck, " + ").concat(commandCycles, "(tCR) > ").concat(target, "(").concat(name, ")"));
    };
    return CommandQueue;
}());
var CommandHistory = /** @class */ (function () {
    function CommandHistory() {
        this.SinceActivate = 65535;
        this.SinceWriteData = 65535;
        this.SinceWrite = 65535;
        this.SinceRead = 65535;
    }
    CommandHistory.prototype.doCycle = function () {
        if (this.SinceRead < 65535)
            this.SinceRead++;
        if (this.SinceWrite < 65535)
            this.SinceWrite++;
        if (this.SinceWriteData < 65535)
            this.SinceWriteData++;
        if (this.SinceActivate < 65535)
            this.SinceActivate++;
    };
    return CommandHistory;
}());
var DqsSchedule = /** @class */ (function () {
    function DqsSchedule(cycles, row, cmd, pre) {
        this.DueCycles = cycles;
        this.RowNumber = row;
        this.Command = cmd;
        this.Preamble = pre;
    }
    return DqsSchedule;
}());
var MemoryController = /** @class */ (function () {
    function MemoryController(tCL, tCWL, tRCD, tRP, tRAS, tRC, tRRDs, tRRDl, tFAW, tWTRs, tWTRl, tWR, tRTP, tCCDl, tCCDs, tREFI, tRFC, tCR, gdm, bgBits, commandCycleMap) {
        var _a;
        var _b, _c, _d, _e, _f;
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
        commandCycleMap !== null && commandCycleMap !== void 0 ? commandCycleMap : (commandCycleMap = {});
        this.commandCycleMap = (_a = {},
            _a[MemCommandEnum.PRE] = (_b = commandCycleMap[MemCommandEnum.PRE]) !== null && _b !== void 0 ? _b : 1,
            _a[MemCommandEnum.ACT] = (_c = commandCycleMap[MemCommandEnum.ACT]) !== null && _c !== void 0 ? _c : 1,
            _a[MemCommandEnum.REF] = (_d = commandCycleMap[MemCommandEnum.REF]) !== null && _d !== void 0 ? _d : 1,
            _a[MemCommandEnum.READ] = (_e = commandCycleMap[MemCommandEnum.READ]) !== null && _e !== void 0 ? _e : 1,
            _a[MemCommandEnum.WRITE] = (_f = commandCycleMap[MemCommandEnum.WRITE]) !== null && _f !== void 0 ? _f : 1,
            _a);
        this.currentCycle = 0;
        this.currentCommand = null;
        this.sinceRefresh = 0;
        this.fawTracking = [];
        this.imcCommandQueue = [];
        this.dqsSchedule = [];
        this.RankHistory = new CommandHistory();
        this.GroupHistory = [];
        for (var i = 0; i < MemoryController.GROUPS; i++) {
            this.GroupHistory.push(new CommandHistory());
        }
        this.BankCmdQueue = [];
        this.BankHistory = [];
        this.BankState = [];
        for (var i = 0; i < MemoryController.BANKS; i++) {
            this.BankCmdQueue.push(new CommandQueue(tCR, this.commandCycleMap));
            this.BankHistory.push(new CommandHistory());
            this.BankState.push(new BankState());
        }
    }
    Object.defineProperty(MemoryController.prototype, "CurrentCycle", {
        get: function () { return this.currentCycle; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(MemoryController.prototype, "CurrentCommand", {
        get: function () { return this.currentCommand; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(MemoryController.prototype, "DqsActive", {
        get: function () { return this.dqsActive; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(MemoryController.prototype, "DqActive", {
        get: function () { return this.dqActive; },
        enumerable: false,
        configurable: true
    });
    MemoryController.prototype.EnqueueCommand = function (cmd) {
        this.imcCommandQueue.push(cmd);
    };
    MemoryController.prototype.maybeEnqueueRefresh = function () {
        if (this.BankCmdQueue.every(function (q) { return q.Empty; }) && this.BankState.every(function (q) { return q.State !== BankStateEnum.Refreshing; })) {
            var preCommand_1 = new MemCommand(MemCommandEnum.PRE, 0, 0);
            preCommand_1.AutoPrecharge = true;
            var refreshCommand_1 = new MemCommand(MemCommandEnum.REF, 0, 0);
            if (!this.BankCmdQueue.every(function (q) { return q.OpenRow === null; })) {
                this.BankCmdQueue.forEach(function (q) { return q.QueueCommand(preCommand_1); });
            }
            this.BankCmdQueue.forEach(function (q) { return q.QueueCommand(refreshCommand_1); });
        }
    };
    MemoryController.prototype.scheduleDqs = function (cmd, dryRun) {
        var delay = ((cmd.Command === MemCommandEnum.READ) ? this.tCL : this.tCWL) + (this.tCR * this.commandCycleMap[cmd.Command]) - 1;
        var prevDqs = this.dqsSchedule.length ? this.dqsSchedule[this.dqsSchedule.length - 1] : null;
        var nextDqs = null;
        var i;
        for (i = 0; i < this.dqsSchedule.length; i++) {
            if (delay < this.dqsSchedule[i].DueCycles) {
                nextDqs = this.dqsSchedule[i];
                if (i > 0) {
                    prevDqs = this.dqsSchedule[i - 1];
                    break;
                }
            }
        }
        var needsPreGap = false;
        var needsPreamble = false;
        var nextNeedsPreGap = false;
        var nextNeedsPreamble = false;
        var totalCycles = 4;
        var preamble = (cmd.Command === MemCommandEnum.READ) ? this.tRPRE : this.tWPRE;
        var nextPreamble = (nextDqs && (nextDqs.Command.Command === MemCommandEnum.READ)) ? this.tRPRE : this.tWPRE;
        var nextDqsDue = nextDqs ? nextDqs.DueCycles : delay + 4 + 1 + nextPreamble;
        var prevDqsEnd = prevDqs ? prevDqs.DueCycles + 4 : delay - 1 - preamble;
        needsPreGap || (needsPreGap = prevDqs && prevDqs.Command.Command !== cmd.Command);
        needsPreamble || (needsPreamble = prevDqsEnd !== delay);
        needsPreamble || (needsPreamble = needsPreGap);
        nextNeedsPreGap || (nextNeedsPreGap = nextDqs && nextDqs.Command.Command !== cmd.Command);
        nextNeedsPreamble || (nextNeedsPreamble = nextDqsDue - 4 !== delay);
        nextNeedsPreamble || (nextNeedsPreamble = nextNeedsPreGap);
        if (needsPreGap)
            totalCycles++;
        if (needsPreamble)
            totalCycles += preamble;
        if (nextNeedsPreGap)
            totalCycles++;
        if (nextNeedsPreamble)
            totalCycles += nextPreamble;
        if ((nextDqsDue - prevDqsEnd) < totalCycles)
            return [false, totalCycles, delay];
        if (dryRun)
            return [true, totalCycles, delay];
        if (nextDqs)
            nextDqs.Preamble = nextNeedsPreamble ? nextPreamble : 0;
        this.dqsSchedule.splice(i, 0, new DqsSchedule(delay, this.BankState[cmd.BankNum].CurrentOpenRow, cmd, needsPreamble ? preamble : 0));
        return [true, totalCycles, delay];
    };
    MemoryController.prototype.issuePrechargeAllBanks = function () {
        var preA = new MemCommand(MemCommandEnum.PRE, 0, 0);
        preA.AutoPrecharge = true;
        this.issueCommand(preA);
    };
    MemoryController.prototype.issueRefresh = function () {
        this.issueCommand(new MemCommand(MemCommandEnum.REF, 0, 0));
    };
    MemoryController.prototype.issueCommand = function (cmd) {
        var bankState = this.BankState[cmd.BankNum];
        var bankHistory = this.BankHistory[cmd.BankNum];
        var groupHistory = this.GroupHistory[cmd.BankGroup];
        var commandCycles = this.tCR * this.commandCycleMap[cmd.Command];
        cmd.NotLatched = commandCycles - 1;
        this.currentCommand = cmd;
        switch (cmd.Command) {
            case MemCommandEnum.REF:
                this.sinceRefresh -= this.tREFI;
                for (var i = 0; i < MemoryController.BANKS; i++) {
                    this.BankState[i].State = BankStateEnum.Refreshing;
                    this.BankState[i].StateCycles = 1 - commandCycles;
                }
                break;
            case MemCommandEnum.PRE:
                if (!cmd.AutoPrecharge) {
                    bankState.State = BankStateEnum.Precharging;
                    bankState.StateCycles = 1 - commandCycles;
                    bankState.CurrentOpenRow = null;
                }
                else {
                    for (var i = 0; i < MemoryController.BANKS; i++) {
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
    };
    MemoryController.prototype.DoCycle = function () {
        var _a;
        if (this.currentCommand) {
            if (!this.currentCommand.NotLatched) {
                this.currentCommand = null;
            }
            else {
                this.currentCommand.NotLatched--;
            }
        }
        this.currentCycle++;
        this.sinceRefresh++;
        this.RankHistory.doCycle();
        this.GroupHistory.forEach(function (v) { return v.doCycle(); });
        this.BankHistory.forEach(function (v) { return v.doCycle(); });
        this.BankState.forEach(function (v) { return v.doCycle(); });
        this.dqsSchedule.forEach(function (v) { return v.DueCycles--; });
        for (var i = 0; i < this.fawTracking.length; i++) {
            this.fawTracking[i]++;
        }
        if (this.fawTracking.length && this.fawTracking[0] >= this.tFAW) {
            this.fawTracking.shift();
        }
        for (var i = 0; i < MemoryController.BANKS; i++) {
            var bankState = this.BankState[i];
            var bankHistory = this.BankHistory[i];
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
                        bankState.WillPrecharge = false;
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
                var imcCommand = this.imcCommandQueue.shift();
                var _b = MemoryController.MapAddress(imcCommand.Address, this.bgBits), group = _b[0], bank = _b[1], row = _b[2], column = _b[3];
                var bankNum = MemoryController.BankNum(group, bank);
                var bankQueue = this.BankCmdQueue[bankNum];
                if (bankQueue.OpenRow !== row) {
                    if (bankQueue.OpenRow !== null)
                        bankQueue.QueueCommand(new MemCommand(MemCommandEnum.PRE, bankNum, 0));
                    bankQueue.QueueCommand(new MemCommand(MemCommandEnum.ACT, bankNum, row));
                }
                bankQueue.QueueCommand(new MemCommand(imcCommand.IsWrite ? MemCommandEnum.WRITE : MemCommandEnum.READ, bankNum, column));
            }
            else if (this.sinceRefresh >= (-4 * this.tREFI)) {
                this.maybeEnqueueRefresh();
            }
        }
        else {
            this.maybeEnqueueRefresh();
        }
        for (var i = 0; i < MemoryController.BANKS; i++) {
            var bankQueue = this.BankCmdQueue[i];
            var bankState = this.BankState[i];
            var bankHistory = this.BankHistory[i];
            var groupHistory = this.GroupHistory[i >> 2];
            var dqsSchedule = void 0;
            bankQueue.StartIssueCheck();
            bankQueue.IssueCheck(this.currentCommand === null, "C/A bus available");
            if (this.gearDown) {
                bankQueue.IssueCheck((this.tCR & 1) == (this.currentCycle & 1), "Gear-Down Latching Cycle");
            }
            if (!bankQueue.Empty) {
                var cmd = bankQueue.FirstCommand;
                switch (cmd.Command) {
                    case MemCommandEnum.ACT:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Idle, "Bank idle");
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRC, "tRC", "Since ACT in bank");
                        bankQueue.TimingCheck(groupHistory.SinceActivate, this.tRRDl, "tRRD_L", "Since ACT in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceActivate, this.tRRDs, "tRRD_S", "Since ACT in rank");
                        bankQueue.IssueCheck(this.fawTracking.length < 4, "ACTs in rank in tFAW: [".concat(this.fawTracking.join(', '), "]"));
                        break;
                    case MemCommandEnum.REF:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Idle, "Bank idle");
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRC, "tRC", "Since ACT in bank");
                        break;
                    case MemCommandEnum.PRE:
                        if (cmd.AutoPrecharge) {
                            bankQueue.IssueCheck(bankState.State === BankStateEnum.Active
                                || bankState.State === BankStateEnum.Precharging
                                || bankState.State === BankStateEnum.Idle, "PreA: Bank active or idle");
                        }
                        else {
                            bankQueue.IssueCheck(bankState.State === BankStateEnum.Active, "Bank active");
                        }
                        bankQueue.IssueCheck(!bankState.WriteTxs, "In-flight WRITEs: ".concat(bankState.WriteTxs));
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRAS, "tRAS", "Since ACT");
                        bankQueue.TimingCheck(bankHistory.SinceRead, this.tRTP, "tRTP", "Since READ");
                        bankQueue.TimingCheck(bankHistory.SinceWriteData, this.tWR, "tWR", "Since WRITE Tx");
                        break;
                    case MemCommandEnum.READ:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Active, "Bank active");
                        bankQueue.IssueCheck(!bankState.WriteTxs, "In-flight WRITEs: ".concat(bankState.WriteTxs));
                        bankQueue.TimingCheck(groupHistory.SinceRead, this.tCCDl, "tCCD_L/tRdRd_sg/tRdRdScL", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWrite, this.tCCDl, "tCCD_L/tWrRd_sg/tWrRd", "Since WRITE in group");
                        bankQueue.TimingCheck(groupHistory.SinceWriteData, this.tWTRl, "tWTR_L", "Since WRITE Tx in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceRead, this.tCCDs, "tCCD_S/tRdRd_dg/tRdRdSc", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWrite, this.tCCDs, "tCCD_S/tWrRd_dg/tWrRd", "Since WRITE in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWriteData, this.tWTRs, "tWTR_S", "Since WRITE Tx in rank");
                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], "DQS available for ".concat(dqsSchedule[1], " cycles after ").concat(dqsSchedule[2], " cycles"));
                        break;
                    case MemCommandEnum.WRITE:
                        bankQueue.IssueCheck(bankState.State === BankStateEnum.Active, "Bank is active");
                        bankQueue.TimingCheck(groupHistory.SinceRead, this.tCCDl, "tCCD_L/tRdWr_sg/tRdWr", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWrite, this.tCCDl, "tCCD_L/tWrWr_sg/tWrWrScL", "Since WRITE in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceRead, this.tCCDs, "tCCD_S/tRdWr_dg/tRdWr", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWrite, this.tCCDs, "tCCD_S/tWrWr_dg/tWrWrSc", "Since WRITE in rank");
                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], "DQS available for ".concat(dqsSchedule[1], " cycles after ").concat(dqsSchedule[2], " cycles"));
                        break;
                }
            }
        }
        var allBankCommand = false;
        if (this.BankCmdQueue.every(function (v) { return v.CanIssue; })) {
            if (this.BankCmdQueue.every(function (v) { return v.FirstCommand.Command === MemCommandEnum.PRE; })) {
                this.issuePrechargeAllBanks();
                allBankCommand = true;
            }
            if (this.BankCmdQueue.every(function (v) { return v.FirstCommand.Command === MemCommandEnum.REF; })) {
                this.issueRefresh();
                allBankCommand = true;
            }
            if (allBankCommand) {
                this.BankCmdQueue.forEach(function (v) { return v.DequeueCommand(); });
            }
        }
        if (!allBankCommand) {
            for (var i = 0; i < MemoryController.BANKS; i++) {
                var bankNum = (i + (this.currentCycle >> 3)) & ((1 << (2 + this.bgBits)) - 1);
                var bankHistory = this.BankHistory[bankNum];
                var bankQueue = this.BankCmdQueue[bankNum];
                if (!bankQueue.CanIssue)
                    continue;
                var cmd = bankQueue.FirstCommand;
                if (cmd.Command === MemCommandEnum.PRE && cmd.AutoPrecharge)
                    continue;
                if (cmd.Command === MemCommandEnum.REF)
                    continue;
                bankQueue.DequeueCommand();
                var canAutoPrecharge = this.UseAutoPrecharge;
                canAutoPrecharge && (canAutoPrecharge = cmd.Command === MemCommandEnum.READ || cmd.Command === MemCommandEnum.WRITE);
                canAutoPrecharge && (canAutoPrecharge = ((_a = bankQueue.FirstCommand) === null || _a === void 0 ? void 0 : _a.Command) === MemCommandEnum.PRE && !bankQueue.FirstCommand.AutoPrecharge);
                if (cmd.Command === MemCommandEnum.READ) {
                    var tWTRa = this.tWR - this.tRTP;
                    canAutoPrecharge && (canAutoPrecharge = bankHistory.SinceWriteData + this.tCR * this.commandCycleMap[MemCommandEnum.READ] > tWTRa);
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
            var dqs = this.dqsSchedule[0];
            switch (dqs.DueCycles) {
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
                    this.dqActive = [dqs.Command.Command, dqs.Command.BankGroup, dqs.Command.Bank, dqs.RowNumber, dqs.Command.Address - dqs.DueCycles * 2];
                    this.dqsActive = true;
                    break;
                case 1:
                case 2:
                    this.dqsActive = dqs.Preamble >= dqs.DueCycles;
                    break;
            }
        }
    };
    MemoryController.MapAddress = function (addr, bgBits) {
        addr >>>= 3;
        var group = addr & ((1 << bgBits) - 1);
        addr >>>= bgBits;
        var column = (addr & 0x7F) << 3;
        addr >>>= 7;
        var bank = addr & 3;
        addr >>>= 2;
        var row = addr;
        return [group, bank, row, column];
    };
    MemoryController.prototype.MapMemArray = function (mem) {
        var addr = mem[2];
        addr <<= 2;
        addr |= mem[1];
        addr <<= 7;
        addr |= mem[3] >>> 3;
        addr <<= this.bgBits;
        addr |= mem[0];
        addr <<= 3;
        return addr;
    };
    MemoryController.BankNum = function (group, bank) { return (group << 2) | bank; };
    MemoryController.BANKS = 32;
    MemoryController.GROUPS = 8;
    return MemoryController;
}());
function $x(e) { return document.getElementById(e); }
function toHex(v, len) {
    if (v === null)
        return null;
    if (v === undefined)
        return undefined;
    var s = v.toString(16).toUpperCase();
    while (s.length < len)
        s = '0' + s;
    return s;
}
function addCmdRow() {
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    var cycleInput = document.createElement('input');
    cycleInput.type = 'number';
    cycleInput.min = cycleInput.value = '1';
    cycleInput.max = '999999';
    cell.appendChild(cycleInput);
    row.appendChild(cell);
    cell = document.createElement('td');
    var rwInput = document.createElement('input');
    rwInput.type = 'checkbox';
    rwInput.className = 'rwCheckBox';
    cell.appendChild(rwInput);
    row.appendChild(cell);
    cell = document.createElement('td');
    var addrInput = document.createElement('input');
    addrInput.type = 'text';
    addrInput.pattern = '[0-9a-fA-F]{1,8}';
    cell.appendChild(addrInput);
    row.appendChild(cell);
    var mapAddrCell = document.createElement('td');
    row.appendChild(mapAddrCell);
    function updateMapAddr() {
        var addr = parseInt(addrInput.value, 16);
        var _a = MemoryController.MapAddress(addr, parseInt($x('bgBits').value)), bankGroup = _a[0], bank = _a[1], aRow = _a[2], col = _a[3];
        mapAddrCell.innerText = "".concat(bankGroup, "/").concat(bank, "/").concat(toHex(aRow, 5), "/").concat(toHex(col, 3));
        if (!row.isConnected) {
            $x('bgBits').removeEventListener('change', updateMapAddr);
        }
    }
    addrInput.onkeyup = updateMapAddr;
    $x('bgBits').addEventListener('change', updateMapAddr);
    cell = document.createElement('td');
    var addButton = document.createElement('button');
    addButton.innerHTML = '+';
    addButton.onclick = addCmdRow;
    cell.appendChild(addButton);
    cell.appendChild(document.createTextNode(' '));
    var delButton = document.createElement('button');
    delButton.innerHTML = '-';
    delButton.onclick = function () {
        cmdTable.removeChild(row);
        $x('bgBits').removeEventListener('change', updateMapAddr);
    };
    cell.appendChild(delButton);
    row.appendChild(cell);
    cmdTable.appendChild(row);
    return [cycleInput, rwInput, addrInput];
}
function getImcCommands() {
    var imcCommands = [];
    var cmdNodes = cmdTable.childNodes;
    for (var i = 0; i < cmdNodes.length; i++) {
        if (cmdNodes[i].tagName === "TR") {
            var cycle = cmdNodes[i].querySelector('input[type=number]').value - 1;
            var addr = parseInt(cmdNodes[i].querySelector('input[type=text]').value, 16);
            var isWr = cmdNodes[i].querySelector('input[type=checkbox]').checked;
            imcCommands.push({ Cycle: cycle, Address: addr, IsWrite: isWr });
        }
        else {
            cmdTable.removeChild(cmdNodes[i]);
            i--;
        }
    }
    imcCommands.sort(function (a, b) { return a.Cycle - b.Cycle; });
    return imcCommands;
}
var stateKey = 'SAVE';
var cmdTable = Array.prototype.slice.apply($x('cmdTable').childNodes).filter(function (v) { return v.tagName === "TBODY"; })[0];
var allParams = [
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
    'ddr5',
    'gearDown',
    'bgBits',
    'cycles',
    'allCycles',
    'useAP'
];
function saveState() {
    var timings = {};
    for (var i = 0; i < allParams.length; i++) {
        var ele = $x(allParams[i]);
        var val = ele.value;
        if (ele.type === "checkbox")
            val = ele.checked;
        if (ele.type === "number")
            val = parseInt(ele.value);
        timings[allParams[i]] = val;
    }
    return {
        params: timings,
        commands: getImcCommands()
    };
}
function loadState(state) {
    var _a, _b;
    if (state === null || state === void 0 ? void 0 : state.params) {
        for (var i = 0; i < allParams.length; i++) {
            var val = state === null || state === void 0 ? void 0 : state.params[allParams[i]];
            if (val === undefined)
                continue;
            var ele = $x(allParams[i]);
            if (ele.type === "checkbox")
                ele.checked = !!val;
            else
                ele.value = val === null || val === void 0 ? void 0 : val.toString();
        }
    }
    if ((_a = state === null || state === void 0 ? void 0 : state.commands) === null || _a === void 0 ? void 0 : _a.length) {
        for (var i = 0; i < state.commands.length; i++) {
            var cmd = state.commands[i];
            if (cmd && cmd.Cycle !== undefined && cmd.Address !== undefined && cmd.IsWrite !== undefined) {
                var _c = addCmdRow(), ci = _c[0], rw = _c[1], ai = _c[2];
                ci.value = (1 + cmd.Cycle).toString();
                rw.checked = !!cmd.IsWrite;
                ai.value = toHex((_b = cmd.Address) !== null && _b !== void 0 ? _b : 0, 8);
            }
        }
    }
    else {
        addCmdRow();
    }
}
var mc;
var mcCommands;
function createController() {
    var commandCycleMap = {};
    if ($x('ddr5').checked) {
        commandCycleMap[MemCommandEnum.ACT] = 2;
        commandCycleMap[MemCommandEnum.READ] = 2;
        commandCycleMap[MemCommandEnum.WRITE] = 2;
    }
    mcCommands = getImcCommands();
    mc = new MemoryController(parseInt($x('tCL').value), parseInt($x('tCWL').value), parseInt($x('tRCD').value), parseInt($x('tRP').value), parseInt($x('tRAS').value), parseInt($x('tRC').value), parseInt($x('tRRDs').value), parseInt($x('tRRDl').value), parseInt($x('tFAW').value), parseInt($x('tWTRs').value), parseInt($x('tWTRl').value), parseInt($x('tWR').value), parseInt($x('tRTP').value), parseInt($x('tCCDl').value), parseInt($x('tCCDs').value), parseInt($x('tREFI').value), parseInt($x('tRFC').value), parseInt($x('tCR').value), $x('gearDown').checked, parseInt($x('bgBits').value), commandCycleMap);
    mc.UseAutoPrecharge = !!$x('useAP').checked;
    return mc;
}
function getOrCreateController() {
    return mc !== null && mc !== void 0 ? mc : (mc = createController());
}
function renderCycleRow() {
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.innerText = mc.CurrentCycle.toString();
    row.appendChild(cell);
    if (mc.CurrentCommand) {
        var cmd = mc.CurrentCommand;
        var cmdClass = cmd.NotLatched ? 'latching' : 'active';
        // Command
        cell = document.createElement('td');
        switch (cmd.Command) {
            case MemCommandEnum.READ:
                cell.innerHTML = "Read";
                break;
            case MemCommandEnum.WRITE:
                cell.innerHTML = "Write";
                break;
            case MemCommandEnum.ACT:
                cell.innerHTML = "Activate";
                break;
            case MemCommandEnum.PRE:
                cell.innerHTML = "Precharge";
                break;
            case MemCommandEnum.REF:
                cell.innerHTML = "Refresh";
                break;
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
        cell.innerText = "".concat(cmd.BankGroup, "/").concat(cmd.Bank);
        switch (cmd.Command) {
            case MemCommandEnum.REF:
                cell.innerText = "All";
                break;
            case MemCommandEnum.PRE:
                if (cmd.AutoPrecharge)
                    cell.innerText = "All";
                break;
        }
        row.appendChild(cell);
        switch (cmd.Command) {
            case MemCommandEnum.ACT:
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT actCol';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "".concat(toHex(cmd.Address, 5));
                cell.className = cmdClass;
                cell.colSpan = 7;
                row.appendChild(cell);
                break;
            case MemCommandEnum.READ:
            case MemCommandEnum.WRITE:
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF actCol';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass + ' a17Col';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = (cmd.Command === MemCommandEnum.READ) ? "H" : 'L';
                cell.className = (cmd.Command === MemCommandEnum.READ) ? "logF" : 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass;
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = cmd.AutoPrecharge ? "H" : 'L';
                cell.className = cmd.AutoPrecharge ? "logT" : 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "".concat(toHex(cmd.Address, 3));
                cell.className = cmdClass;
                row.appendChild(cell);
                break;
            case MemCommandEnum.PRE:
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF actCol';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass + ' a17Col';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = 'L';
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass;
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = cmd.AutoPrecharge ? "H" : 'L';
                cell.className = cmd.AutoPrecharge ? "logT" : 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass;
                row.appendChild(cell);
                break;
            case MemCommandEnum.REF:
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF actCol';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass + ' a17Col';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = 'L';
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass;
                cell.colSpan = 3;
                row.appendChild(cell);
                break;
        }
    }
    else {
        cell = document.createElement('td');
        cell.colSpan = 10;
        cell.className = 'inactive';
        row.appendChild(cell);
    }
    cell = document.createElement('td');
    cell.innerText = mc.DqsActive ? "\u2B5C\u2B5D" : '';
    if (mc.DqsActive) {
        cell.className = mc.DqActive ? 'active' : 'latching';
    }
    else {
        cell.className = 'inactive';
    }
    row.appendChild(cell);
    var dq = ['', ''];
    if (mc.DqActive) {
        dq[0] = (mc.DqActive && mc.DqActive[0] === MemCommandEnum.READ) ? 'R' : 'W';
        // @ts-ignore
        dq[1] = toHex(mc.MapMemArray(mc.DqActive.slice(1)), 8);
    }
    cell = document.createElement('td');
    cell.innerText = mc.DqActive ? dq.join(' ') : '';
    cell.className = mc.DqActive ? 'active' : 'inactive';
    row.appendChild(cell);
    return row;
}
function createTableWithHead() {
    var title = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        title[_i] = arguments[_i];
    }
    var table = document.createElement('table');
    var thead = document.createElement('thead');
    var titleRow = document.createElement('tr');
    for (var i = 0; i < title.length; i++) {
        var header = document.createElement('th');
        header.innerText = title[i];
        titleRow.appendChild(header);
    }
    thead.appendChild(titleRow);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    return [table, tbody];
}
function createTableRow() {
    var _a;
    var cells = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        cells[_i] = arguments[_i];
    }
    var row = document.createElement('tr');
    for (var i = 0; i < cells.length; i++) {
        var cell = document.createElement('td');
        if (cells[i] === null) {
            cell.innerText = '-';
        }
        else if (cells[i] === undefined) {
        }
        else {
            if (cells[i] instanceof HTMLElement) {
                cell.appendChild(cells[i]);
            }
            else {
                cell.innerText = (_a = cells[i]) === null || _a === void 0 ? void 0 : _a.toString();
            }
        }
        row.appendChild(cell);
    }
    return row;
}
function renderState(st) {
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
function renderIssueCheck(checks) {
    if (!checks) {
        return undefined;
    }
    var container = document.createElement('div');
    for (var i = 0; i < checks.length; i++) {
        var check = document.createElement('div');
        if (checks[i][0]) {
            check.style.color = "darkgreen";
            check.innerText = '✓ ';
        }
        else {
            check.style.color = "darkred";
            check.innerText = '✗ ';
        }
        check.innerText += checks[i][1];
        container.appendChild(check);
    }
    return container;
}
function renderCommandQueue(cmds) {
    if (!cmds) {
        return undefined;
    }
    var container = document.createElement('div');
    for (var i = 0; i < cmds.length; i++) {
        var cmd = document.createElement('div');
        cmd.innerText = cmds[i].toString();
        container.appendChild(cmd);
    }
    return container;
}
function renderStateDumpBankGroup(bg) {
    var _a, _b, _c, _d;
    var container = document.createElement('div');
    var title = document.createElement('p');
    title.innerText = "Bank Group ".concat(bg);
    container.appendChild(title);
    bg <<= 2;
    var _e = createTableWithHead('', 'Bank 0', 'Bank 1', 'Bank 2', 'Bank 3'), table = _e[0], tbody = _e[1];
    var mc = getOrCreateController();
    tbody.appendChild(createTableRow('State', renderState(mc.BankState[bg].State), renderState(mc.BankState[bg + 1].State), renderState(mc.BankState[bg + 2].State), renderState(mc.BankState[bg + 3].State)));
    tbody.appendChild(createTableRow('Cycles', mc.BankState[bg].StateCycles, mc.BankState[bg + 1].StateCycles, mc.BankState[bg + 2].StateCycles, mc.BankState[bg + 3].StateCycles));
    tbody.appendChild(createTableRow('Open Row', toHex(mc.BankState[bg].CurrentOpenRow, 5), toHex(mc.BankState[bg + 1].CurrentOpenRow, 5), toHex(mc.BankState[bg + 2].CurrentOpenRow, 5), toHex(mc.BankState[bg + 3].CurrentOpenRow, 5)));
    tbody.appendChild(createTableRow('AP Engaged', mc.BankState[bg].WillPrecharge, mc.BankState[bg + 1].WillPrecharge, mc.BankState[bg + 2].WillPrecharge, mc.BankState[bg + 3].WillPrecharge));
    tbody.appendChild(createTableRow('Active WRITEs', mc.BankState[bg].WriteTxs, mc.BankState[bg + 1].WriteTxs, mc.BankState[bg + 2].WriteTxs, mc.BankState[bg + 3].WriteTxs));
    tbody.appendChild(createTableRow('Last ACT', mc.BankHistory[bg].SinceActivate, mc.BankHistory[bg + 1].SinceActivate, mc.BankHistory[bg + 2].SinceActivate, mc.BankHistory[bg + 3].SinceActivate));
    tbody.appendChild(createTableRow('Last READ', mc.BankHistory[bg].SinceRead, mc.BankHistory[bg + 1].SinceRead, mc.BankHistory[bg + 2].SinceRead, mc.BankHistory[bg + 3].SinceRead));
    tbody.appendChild(createTableRow('Last WRITE', mc.BankHistory[bg].SinceWrite, mc.BankHistory[bg + 1].SinceWrite, mc.BankHistory[bg + 2].SinceWrite, mc.BankHistory[bg + 3].SinceWrite));
    tbody.appendChild(createTableRow('Last WRITE Tx', mc.BankHistory[bg].SinceWriteData, mc.BankHistory[bg + 1].SinceWriteData, mc.BankHistory[bg + 2].SinceWriteData, mc.BankHistory[bg + 3].SinceWriteData));
    tbody.appendChild(createTableRow('Next Command', (_a = mc.BankCmdQueue[bg].CheckCmd) === null || _a === void 0 ? void 0 : _a.toString(), (_b = mc.BankCmdQueue[bg + 1].CheckCmd) === null || _b === void 0 ? void 0 : _b.toString(), (_c = mc.BankCmdQueue[bg + 2].CheckCmd) === null || _c === void 0 ? void 0 : _c.toString(), (_d = mc.BankCmdQueue[bg + 3].CheckCmd) === null || _d === void 0 ? void 0 : _d.toString()));
    tbody.appendChild(createTableRow('Issue Check', renderIssueCheck(mc.BankCmdQueue[bg].CheckCmd && mc.BankCmdQueue[bg].IssueChecks), renderIssueCheck(mc.BankCmdQueue[bg + 1].CheckCmd && mc.BankCmdQueue[bg + 1].IssueChecks), renderIssueCheck(mc.BankCmdQueue[bg + 2].CheckCmd && mc.BankCmdQueue[bg + 2].IssueChecks), renderIssueCheck(mc.BankCmdQueue[bg + 3].CheckCmd && mc.BankCmdQueue[bg + 3].IssueChecks)));
    tbody.appendChild(createTableRow('Command Queue', renderCommandQueue(mc.BankCmdQueue[bg].AllCommand), renderCommandQueue(mc.BankCmdQueue[bg + 1].AllCommand), renderCommandQueue(mc.BankCmdQueue[bg + 2].AllCommand), renderCommandQueue(mc.BankCmdQueue[bg + 3].AllCommand)));
    container.appendChild(table);
    return container;
}
function renderStateDumpRank(bgs) {
    var container = document.createElement('div');
    var title = document.createElement('p');
    title.innerText = "Rank Status";
    container.appendChild(title);
    var headers = [''];
    for (var i = 0; i < bgs; i++) {
        headers.push("Group ".concat(i));
    }
    headers.push('Rank');
    var _a = createTableWithHead.apply(void 0, headers), table = _a[0], tbody = _a[1];
    var mc = getOrCreateController();
    function gatherHistory(sel) {
        var r = [];
        for (var i = 0; i < bgs; i++) {
            r.push(sel(mc.GroupHistory[i]));
        }
        r.push(sel(mc.RankHistory));
        return r;
    }
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['ACT'], gatherHistory(function (v) { return v.SinceActivate; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['READ'], gatherHistory(function (v) { return v.SinceRead; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['WRITE'], gatherHistory(function (v) { return v.SinceWrite; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['WRITE Tx'], gatherHistory(function (v) { return v.SinceWriteData; }), false)));
    container.appendChild(table);
    return container;
}
function renderStateDump() {
    var dumpRoot = $x('stateDump');
    while (dumpRoot.hasChildNodes())
        dumpRoot.removeChild(dumpRoot.childNodes[0]);
    var bgs = 1 << parseInt($x('bgBits').value);
    for (var i = 0; i < bgs; i++) {
        dumpRoot.appendChild(renderStateDumpBankGroup(i));
    }
    dumpRoot.appendChild(renderStateDumpRank(bgs));
}
function doCycles(cycles) {
    var mc = getOrCreateController();
    var allCycles = $x('allCycles').checked;
    var tableBody = $x('cycleTable');
    for (var i = 0; i < tableBody.childNodes.length; i++) {
        if (tableBody.childNodes[i].tagName === "TBODY") {
            tableBody = tableBody.childNodes[i];
            break;
        }
    }
    var outputDesCycle = true;
    for (var i = 0; i < cycles; i++) {
        while (mcCommands.length && mcCommands[0].Cycle === mc.CurrentCycle) {
            mc.EnqueueCommand(mcCommands.shift());
        }
        mc.DoCycle();
        outputDesCycle || (outputDesCycle = mc.DqsActive);
        if (mc.CurrentCommand || mc.DqsActive || outputDesCycle || allCycles) {
            tableBody.appendChild(renderCycleRow());
        }
        outputDesCycle = !!(mc.CurrentCommand || mc.DqsActive);
    }
    renderStateDump();
}
$x('go').onclick = function () {
    doCycles(parseInt($x('cycles').value));
};
$x('step').onclick = function () {
    doCycles(1);
};
$x('reset').onclick = function () {
    mc = null;
    mcCommands = null;
    var cycleTable = $x('cycleTable');
    var tableBody = document.createElement('tbody');
    for (var i = 0; i < cycleTable.childNodes.length; i++) {
        if (cycleTable.childNodes[i].tagName === "THEAD")
            continue;
        cycleTable.removeChild(cycleTable.childNodes[i]);
        i--;
    }
    cycleTable.appendChild(tableBody);
    var dumpRoot = $x('stateDump');
    while (dumpRoot.hasChildNodes())
        dumpRoot.removeChild(dumpRoot.childNodes[0]);
};
loadState(JSON.parse(localStorage.getItem(stateKey)));
$x('bgBits').dispatchEvent(new Event("change"));
window.onunload = function () {
    localStorage.setItem(stateKey, JSON.stringify(saveState()));
};
//# sourceMappingURL=script.js.map