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
    function MemCommand(cmd, bg, ba, bank, addr) {
        this.Command = cmd;
        this.Bank = ba;
        this.Group = bg;
        this.BankNum = bank;
        this.Address = addr;
        this.AutoPrecharge = false;
    }
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
    Object.defineProperty(CommandQueue.prototype, "Pending", {
        get: function () { return this.queue.length; },
        enumerable: false,
        configurable: true
    });
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
    CommandQueue.prototype.StateCheck = function (desc, currentState) {
        var allowedStates = [];
        for (var _i = 2; _i < arguments.length; _i++) {
            allowedStates[_i - 2] = arguments[_i];
        }
        var pass = false;
        for (var i = 0; !pass && i < allowedStates.length; i++) {
            pass = currentState === allowedStates[i];
        }
        this.IssueCheck(pass, desc);
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
        this.SinceRefresh = -4;
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
        if (this.SinceRefresh < 1048575)
            this.SinceRefresh++;
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
var AddressMapConfig = /** @class */ (function () {
    function AddressMapConfig(bg, ba, ca, bl) {
        this.BG = bg;
        this.BA = ba;
        this.CA = ca;
        this.BL = bl;
        this.Groups = 1 << bg;
        this.Banks = this.Groups * (1 << ba);
    }
    return AddressMapConfig;
}());
var MemoryController = /** @class */ (function () {
    function MemoryController(tCL, tCWL, tRCDrd, tRCDwr, tRP, tRAS, tRC, tRRDs, tRRDl, tFAW, tWTRs, tWTRl, tWR, tRTP, tWRa, tRTPa, tRdWrSg, tRdWrDg, tRdRdSg, tRdRdDg, tWrWrSg, tWrWrDg, tREFI, tRFC, tCR, gdm, addrCfg, commandCycleMap) {
        var _a;
        var _b, _c, _d, _e, _f;
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
        this.fawTracking = [];
        this.imcCommandQueue = [];
        this.dqsSchedule = [];
        this.RankHistory = new CommandHistory();
        this.GroupHistory = [];
        for (var i = 0; i < addrCfg.Groups; i++) {
            this.GroupHistory.push(new CommandHistory());
        }
        this.BankCmdQueue = [];
        this.BankHistory = [];
        this.BankState = [];
        for (var i = 0; i < addrCfg.Banks; i++) {
            this.BankCmdQueue.push(new CommandQueue(tCR, this.commandCycleMap));
            this.BankHistory.push(new CommandHistory());
            this.BankState.push(new BankState());
        }
        this.QueueBound = 12;
    }
    Object.defineProperty(MemoryController.prototype, "CommandRate", {
        get: function () { return this.tCR; },
        enumerable: false,
        configurable: true
    });
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
            var preCommand_1 = new MemCommand(MemCommandEnum.PRE, 0, 0, 0, 0);
            preCommand_1.AutoPrecharge = true;
            var refreshCommand_1 = new MemCommand(MemCommandEnum.REF, 0, 0, 0, 0);
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
        var totalCycles = 1 << (this.AddrCfg.BL - 1);
        var preamble = (cmd.Command === MemCommandEnum.READ) ? this.tRPRE : this.tWPRE;
        var nextPreamble = (nextDqs && (nextDqs.Command.Command === MemCommandEnum.READ)) ? this.tRPRE : this.tWPRE;
        var nextDqsDue = nextDqs ? nextDqs.DueCycles : delay + totalCycles + 1 + nextPreamble;
        var prevDqsEnd = prevDqs ? prevDqs.DueCycles + totalCycles : delay - 1 - preamble;
        needsPreGap || (needsPreGap = prevDqs && prevDqs.Command.Command !== cmd.Command);
        needsPreamble || (needsPreamble = prevDqsEnd !== delay);
        needsPreamble || (needsPreamble = needsPreGap);
        nextNeedsPreGap || (nextNeedsPreGap = nextDqs && nextDqs.Command.Command !== cmd.Command);
        nextNeedsPreamble || (nextNeedsPreamble = nextDqsDue - totalCycles !== delay);
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
        if (!dryRun) {
            if (nextDqs)
                nextDqs.Preamble = nextNeedsPreamble ? nextPreamble : 0;
            this.dqsSchedule.splice(i, 0, new DqsSchedule(delay, this.BankState[cmd.BankNum].CurrentOpenRow, cmd, needsPreamble ? preamble : 0));
        }
        return [true, totalCycles, delay];
    };
    MemoryController.prototype.issueCommand = function (cmd) {
        var bankState = this.BankState[cmd.BankNum];
        var bankHistory = this.BankHistory[cmd.BankNum];
        var groupHistory = this.GroupHistory[cmd.Group];
        var commandCycles = this.tCR * this.commandCycleMap[cmd.Command];
        cmd.NotLatched = commandCycles - 1;
        this.currentCommand = cmd;
        switch (cmd.Command) {
            case MemCommandEnum.REF:
                this.RankHistory.SinceRefresh -= this.tREFI;
                for (var i = 0; i < this.AddrCfg.Banks; i++) {
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
                    for (var i = 0; i < this.AddrCfg.Banks; i++) {
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
    MemoryController.prototype.updateBankStates = function () {
        for (var i = 0; i < this.AddrCfg.Banks; i++) {
            var bankState = this.BankState[i];
            var bankHistory = this.BankHistory[i];
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
    };
    MemoryController.prototype.decodeOneCommandOrRefresh = function () {
        if (this.RankHistory.SinceRefresh < 4 * this.tREFI) {
            for (var i = 0; i < this.imcCommandQueue.length; i++) {
                var imcCommand = this.imcCommandQueue[i];
                var _a = MemoryController.MapAddress(imcCommand.Address, this.AddrCfg), group = _a[0], bank = _a[1], row = _a[2], column = _a[3];
                var bankNum = (group << this.AddrCfg.BA) | bank;
                var bankQueue = this.BankCmdQueue[bankNum];
                if (this.QueueBound && bankQueue.Pending >= this.QueueBound) {
                    if (imcCommand.IsWrite)
                        break;
                    continue;
                }
                if (bankQueue.OpenRow !== row) {
                    if (bankQueue.OpenRow !== null)
                        bankQueue.QueueCommand(new MemCommand(MemCommandEnum.PRE, group, bank, bankNum, 0));
                    bankQueue.QueueCommand(new MemCommand(MemCommandEnum.ACT, group, bank, bankNum, row));
                }
                bankQueue.QueueCommand(new MemCommand(imcCommand.IsWrite ? MemCommandEnum.WRITE : MemCommandEnum.READ, group, bank, bankNum, column));
                this.imcCommandQueue.splice(i, 1);
                return;
            }
        }
        if (this.RankHistory.SinceRefresh >= (-4 * this.tREFI)) {
            this.maybeEnqueueRefresh();
        }
    };
    MemoryController.prototype.checkBankCommandQueue = function () {
        for (var i = 0; i < this.AddrCfg.Banks; i++) {
            var bankQueue = this.BankCmdQueue[i];
            var bankState = this.BankState[i];
            var bankHistory = this.BankHistory[i];
            var groupHistory = this.GroupHistory[i >> this.AddrCfg.BA];
            var dqsSchedule = void 0;
            bankQueue.StartIssueCheck();
            bankQueue.IssueCheck(this.currentCommand === null, "C/A bus available");
            if (this.gearDown) {
                bankQueue.IssueCheck((this.tCR & 1) == (this.currentCycle & 1), "Gear-Down Command Cycle");
            }
            if (!bankQueue.Empty) {
                var cmd = bankQueue.FirstCommand;
                switch (cmd.Command) {
                    case MemCommandEnum.ACT:
                        bankQueue.StateCheck("Bank idle", bankState.State, BankStateEnum.Idle);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRC, "tRC", "Since ACT in bank");
                        bankQueue.TimingCheck(groupHistory.SinceActivate, this.tRRDl, "tRRD_L", "Since ACT in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceActivate, this.tRRDs, "tRRD_S", "Since ACT in rank");
                        bankQueue.IssueCheck(this.fawTracking.length < 4, "ACTs in rank in tFAW: [".concat(this.fawTracking.join(', '), "]"));
                        break;
                    case MemCommandEnum.REF:
                        bankQueue.StateCheck("Bank idle", bankState.State, BankStateEnum.Idle);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRC, "tRC", "Since ACT in bank");
                        break;
                    case MemCommandEnum.PRE:
                        if (cmd.AutoPrecharge) {
                            bankQueue.StateCheck("PreA: Bank active or idle", bankState.State, BankStateEnum.Active, BankStateEnum.Activating, BankStateEnum.Precharging, BankStateEnum.Idle);
                        }
                        else {
                            bankQueue.StateCheck("Bank active", bankState.State, BankStateEnum.Active, BankStateEnum.Activating);
                        }
                        bankQueue.IssueCheck(!bankState.WriteTxs, "In-flight WRITEs: ".concat(bankState.WriteTxs));
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRAS, "tRAS", "Since ACT");
                        bankQueue.TimingCheck(bankHistory.SinceRead, this.tRTP, "tRTP", "Since READ");
                        bankQueue.TimingCheck(bankHistory.SinceWriteData, this.tWR, "tWR", "Since WRITE Tx");
                        break;
                    case MemCommandEnum.READ:
                        bankQueue.StateCheck("Bank active", bankState.State, BankStateEnum.Active, BankStateEnum.Activating);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRCDrd, "tRCDrd", "Since bank ACT");
                        bankQueue.IssueCheck(!bankState.WriteTxs, "In-flight WRITEs: ".concat(bankState.WriteTxs));
                        bankQueue.TimingCheck(groupHistory.SinceRead, this.tRdRdSg, "tRdRd_sg/tRdRdScL", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWriteData, this.tWTRl, "tWTR_L", "Since WRITE Tx in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceRead, this.tRdRdDg, "tRdRd_dg/tRdRdSc", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWriteData, this.tWTRs, "tWTR_S", "Since WRITE Tx in rank");
                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], "DQS available for ".concat(dqsSchedule[1], " cycles after ").concat(dqsSchedule[2], " cycles"));
                        break;
                    case MemCommandEnum.WRITE:
                        bankQueue.StateCheck("Bank active", bankState.State, BankStateEnum.Active, BankStateEnum.Activating);
                        bankQueue.TimingCheck(bankHistory.SinceActivate, this.tRCDwr, "tRCDwr", "Since bank ACT");
                        bankQueue.TimingCheck(groupHistory.SinceRead, this.tRdWrSg, "tRdWr_sg", "Since READ in group");
                        bankQueue.TimingCheck(groupHistory.SinceWrite, this.tWrWrSg, "tWrWr_sg/tWrWrScL", "Since WRITE in group");
                        bankQueue.TimingCheck(this.RankHistory.SinceRead, this.tRdWrDg, "tRdWr_dg", "Since READ in rank");
                        bankQueue.TimingCheck(this.RankHistory.SinceWrite, this.tWrWrDg, "tWrWr_dg/tWrWrSc", "Since WRITE in rank");
                        dqsSchedule = this.scheduleDqs(cmd, true);
                        bankQueue.IssueCheck(dqsSchedule[0], "DQS available for ".concat(dqsSchedule[1], " cycles after ").concat(dqsSchedule[2], " cycles"));
                        break;
                }
            }
        }
    };
    MemoryController.prototype.maybeIssueAllBankCommand = function () {
        if (this.BankCmdQueue.every(function (v) { return v.CanIssue; })) {
            if (this.BankCmdQueue.every(function (v) { return v.FirstCommand.Command === MemCommandEnum.PRE; })) {
                this.BankCmdQueue.forEach(function (v) { return v.DequeueCommand(); });
                var preA = new MemCommand(MemCommandEnum.PRE, 0, 0, 0, 0);
                preA.AutoPrecharge = true;
                this.issueCommand(preA);
                return true;
            }
            if (this.BankCmdQueue.every(function (v) { return v.FirstCommand.Command === MemCommandEnum.REF; })) {
                this.BankCmdQueue.forEach(function (v) { return v.DequeueCommand(); });
                this.issueCommand(new MemCommand(MemCommandEnum.REF, 0, 0, 0, 0));
                return true;
            }
        }
        return false;
    };
    MemoryController.prototype.issueOneCommand = function () {
        var _a;
        for (var i = 0; i < this.AddrCfg.Banks; i++) {
            var bankNum = (i + (this.currentCycle >> 1)) & (this.AddrCfg.Banks - 1);
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
            var canAutoPrecharge = cmd.Command === MemCommandEnum.READ || cmd.Command === MemCommandEnum.WRITE;
            canAutoPrecharge && (canAutoPrecharge = ((_a = bankQueue.FirstCommand) === null || _a === void 0 ? void 0 : _a.Command) === MemCommandEnum.PRE && !bankQueue.FirstCommand.AutoPrecharge);
            if (cmd.Command === MemCommandEnum.READ) {
                var tWTRa = this.tWR - this.tRTP;
                canAutoPrecharge && (canAutoPrecharge = bankHistory.SinceWriteData + this.tCR * this.commandCycleMap[MemCommandEnum.READ] > tWTRa);
                canAutoPrecharge && (canAutoPrecharge = this.tRTPa === this.tRTP);
            }
            if (cmd.Command === MemCommandEnum.WRITE) {
                canAutoPrecharge && (canAutoPrecharge = this.tWRa === this.tWR);
            }
            if (canAutoPrecharge) {
                cmd.AutoPrecharge = true;
                bankQueue.DequeueCommand();
            }
            this.issueCommand(cmd);
            break;
        }
    };
    MemoryController.prototype.DoCycle = function () {
        if (this.currentCommand) {
            if (!this.currentCommand.NotLatched) {
                this.currentCommand = null;
            }
            else {
                this.currentCommand.NotLatched--;
            }
        }
        this.currentCycle++;
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
        this.updateBankStates();
        this.decodeOneCommandOrRefresh();
        this.checkBankCommandQueue();
        if (!this.maybeIssueAllBankCommand()) {
            this.issueOneCommand();
        }
        this.dqActive = null;
        this.dqsActive = false;
        if (this.dqsSchedule.length) {
            var dqs = this.dqsSchedule[0];
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
            }
            else {
                this.dqsActive = dqs.Preamble >= dqs.DueCycles;
            }
        }
    };
    MemoryController.MapAddress = function (addr, addrCfg) {
        var bgBits = addrCfg.BG;
        addr >>>= addrCfg.BL;
        var group = 0;
        if (bgBits) {
            group = addr & 1;
            bgBits--;
            addr >>>= 1;
        }
        var column = (addr & ((1 << (addrCfg.CA - addrCfg.BL)) - 1)) << addrCfg.BL;
        addr >>>= addrCfg.CA - addrCfg.BL;
        if (bgBits) {
            group |= (addr & 1) << 1;
            bgBits--;
            addr >>>= 1;
        }
        var bank = addr & ((1 << addrCfg.BA) - 1);
        addr >>>= addrCfg.BA;
        if (bgBits) {
            group |= (addr & ((1 << bgBits) - 1)) << 2;
            addr >>>= bgBits;
        }
        var row = addr;
        return [group, bank, row, column];
    };
    MemoryController.prototype.MapMemArray = function (mem) {
        var addr = mem[2];
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
    };
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
function getAddrMapConfig() {
    return new AddressMapConfig(parseInt($x('bgBits').value), parseInt($x('baBits').value), parseInt($x('caBits').value), parseInt($x('blBits').value));
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
        var _a = MemoryController.MapAddress(addr, getAddrMapConfig()), bankGroup = _a[0], bank = _a[1], aRow = _a[2], col = _a[3];
        mapAddrCell.innerText = "".concat(bankGroup, "/").concat(bank, "/").concat(toHex(aRow, 5), "/").concat(toHex(col, 3));
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
                ai.value = toHex((_b = cmd.Address) !== null && _b !== void 0 ? _b : 0, 9);
            }
        }
    }
    else {
        addCmdRow();
    }
}
var mc;
var memClock;
var mcUseDdr5;
var mcCommands;
function createController() {
    var commandCycleMap = {};
    mcUseDdr5 = $x('ddr5').checked;
    if (mcUseDdr5) {
        commandCycleMap[MemCommandEnum.ACT] = 2;
        commandCycleMap[MemCommandEnum.READ] = 2;
        commandCycleMap[MemCommandEnum.WRITE] = 2;
    }
    var tWR = parseInt($x('tWR').value);
    var tRTP = parseInt($x('tRTP').value);
    var tWRa, tRTPa;
    if (mcUseDdr5) {
        commandCycleMap[MemCommandEnum.ACT] = 2;
        commandCycleMap[MemCommandEnum.READ] = 2;
        commandCycleMap[MemCommandEnum.WRITE] = 2;
        if (tRTP <= 12) {
            tRTPa = 12;
        }
        else if (tRTP >= 24) {
            tRTPa = 24;
        }
        else {
            tRTPa = Math.ceil(Math.ceil(tRTP / 1.5) * 1.5);
        }
        if (tWR <= 48) {
            tWRa = 48;
        }
        else if (tWR >= 96) {
            tWRa = 96;
        }
        else {
            tWRa = Math.ceil(tWR / 6) * 6;
        }
    }
    else {
        if (tRTP <= 5) {
            tRTPa = 5;
        }
        else if (tRTP >= 14) {
            tRTPa = 14;
        }
        else {
            tRTPa = tRTP;
        }
        tWRa = tRTPa * 2;
    }
    if (!$x('useAP').checked) {
        tWRa = tRTPa = null;
    }
    mcCommands = getImcCommands();
    mc = new MemoryController(parseInt($x('tCL').value), parseInt($x('tCWL').value), parseInt($x('tRCDrd').value), parseInt($x('tRCDwr').value), parseInt($x('tRP').value), parseInt($x('tRAS').value), parseInt($x('tRC').value), parseInt($x('tRRDs').value), parseInt($x('tRRDl').value), parseInt($x('tFAW').value), parseInt($x('tWTRs').value), parseInt($x('tWTRl').value), tWR, tRTP, tWRa, tRTPa, parseInt($x('tRdWrSg').value), parseInt($x('tRdWrDg').value), parseInt($x('tRdRdSg').value), parseInt($x('tRdRdDg').value), parseInt($x('tWrWrSg').value), parseInt($x('tWrWrDg').value), parseInt($x('tREFI').value), parseInt($x('tRFC').value), parseInt($x('tCR').value), $x('gearDown').checked, getAddrMapConfig(), commandCycleMap);
    memClock = parseInt($x('memTxSpeed').value);
    var mcString = (memClock * 3).toString();
    if (mcString.match(/98$/)) {
        memClock += 2 / 3;
    }
    else if (mcString.match(/99$/)) {
        memClock += 1 / 3;
    }
    else if (mcString.match(/01$/)) {
        memClock -= 1 / 3;
    }
    memClock /= 2;
    mc.QueueBound = 0;
    return mc;
}
function getOrCreateController() {
    return mc !== null && mc !== void 0 ? mc : (mc = createController());
}
function renderCycleRow() {
    var row = document.createElement('tr');
    var cell = document.createElement('td');
    cell.innerText = (1000 * mc.CurrentCycle / memClock).toFixed(1);
    row.appendChild(cell);
    cell = document.createElement('td');
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
        cell.innerText = "".concat(cmd.Group, "/").concat(cmd.Bank);
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
        // CS
        cell = document.createElement('td');
        if (mcUseDdr5) {
            var cmdCycles = 1;
            switch (cmd.Command) {
                case MemCommandEnum.ACT:
                case MemCommandEnum.READ:
                case MemCommandEnum.WRITE:
                    cmdCycles = 2;
                    break;
            }
            if ((mc.CommandRate + cmd.NotLatched) < (cmdCycles * mc.CommandRate)) {
                cell.className = 'logF';
                cell.innerText = "H";
            }
            else {
                cell.className = 'logT';
                cell.innerText = "L";
            }
        }
        else {
            cell.className = cmd.NotLatched ? 'logF' : 'logT';
            cell.innerText = cmd.NotLatched ? 'H' : 'L';
        }
        row.appendChild(cell);
        switch (cmd.Command) {
            case MemCommandEnum.ACT:
                // RAS/CAS/WE
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                // Address
                cell = document.createElement('td');
                cell.innerText = "".concat(toHex(cmd.Address, 5));
                cell.className = cmdClass;
                cell.colSpan = 2;
                row.appendChild(cell);
                break;
            case MemCommandEnum.READ:
            case MemCommandEnum.WRITE:
                // RAS/CAS/WE
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
                // AP
                cell = document.createElement('td');
                cell.innerText = cmd.AutoPrecharge ? "H" : 'L';
                cell.className = cmd.AutoPrecharge ? "logT" : 'logF';
                row.appendChild(cell);
                // Address
                cell = document.createElement('td');
                cell.innerText = "".concat(toHex(cmd.Address, 3));
                cell.className = cmdClass;
                row.appendChild(cell);
                break;
            case MemCommandEnum.PRE:
                // RAS/CAS/WE
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                // AP
                cell = document.createElement('td');
                cell.innerText = cmd.AutoPrecharge ? "H" : 'L';
                cell.className = cmd.AutoPrecharge ? "logT" : 'logF';
                row.appendChild(cell);
                // Address
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass;
                row.appendChild(cell);
                break;
            case MemCommandEnum.REF:
                // RAS/CAS/WE
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "L";
                cell.className = 'logT';
                row.appendChild(cell);
                cell = document.createElement('td');
                cell.innerText = "H";
                cell.className = 'logF';
                row.appendChild(cell);
                // Address
                cell = document.createElement('td');
                cell.innerText = "-";
                cell.className = cmdClass;
                cell.colSpan = 2;
                row.appendChild(cell);
                break;
        }
    }
    else {
        cell = document.createElement('td');
        cell.colSpan = 8;
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
        dq[1] = toHex(mc.MapMemArray(mc.DqActive.slice(1)), 9);
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
            if (cells[i] instanceof HTMLTableCellElement) {
                row.appendChild(cells[i]);
                continue;
            }
            else if (cells[i] instanceof HTMLElement) {
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
        if (i === 11 && cmds.length > 12) {
            cmd.innerText = "... (+".concat(cmds.length - i, ")");
            container.appendChild(cmd);
            break;
        }
        cmd.innerText = cmds[i].toString();
        container.appendChild(cmd);
    }
    return container;
}
function renderStateDumpBankGroup(bg) {
    var container = document.createElement('div');
    var title = document.createElement('p');
    title.innerText = "Bank Group ".concat(bg);
    container.appendChild(title);
    var mc = getOrCreateController();
    var bas = 1 << mc.AddrCfg.BA;
    bg <<= mc.AddrCfg.BA;
    var headers = [''];
    for (var i = 0; i < bas; i++) {
        headers.push("Bank ".concat(i));
    }
    function gatherData(sel) {
        var r = [];
        for (var i = 0; i < bas; i++) {
            r.push(sel(mc, bg + i));
        }
        return r;
    }
    var _a = createTableWithHead.apply(void 0, headers), table = _a[0], tbody = _a[1];
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['State'], gatherData(function (mc, bg) { return renderState(mc.BankState[bg].State); }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Cycles'], gatherData(function (mc, bg) { return mc.BankState[bg].StateCycles; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Open Row'], gatherData(function (mc, bg) { return toHex(mc.BankState[bg].CurrentOpenRow, 5); }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['AP Engaged'], gatherData(function (mc, bg) { return mc.BankState[bg].WillPrecharge; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Active WRITEs'], gatherData(function (mc, bg) { return mc.BankState[bg].WriteTxs; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Last ACT'], gatherData(function (mc, bg) { return mc.BankHistory[bg].SinceActivate; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Last READ'], gatherData(function (mc, bg) { return mc.BankHistory[bg].SinceRead; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Last WRITE'], gatherData(function (mc, bg) { return mc.BankHistory[bg].SinceWrite; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Last WRITE Tx'], gatherData(function (mc, bg) { return mc.BankHistory[bg].SinceWriteData; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Next Command'], gatherData(function (mc, bg) { return mc.BankCmdQueue[bg].CheckCmd; }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Issue Check'], gatherData(function (mc, bg) { return renderIssueCheck(mc.BankCmdQueue[bg].CheckCmd && mc.BankCmdQueue[bg].IssueChecks); }), false)));
    tbody.appendChild(createTableRow.apply(void 0, __spreadArray(['Command Queue'], gatherData(function (mc, bg) { return renderCommandQueue(mc.BankCmdQueue[bg].AllCommand); }), false)));
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
    var refreshCell = document.createElement('td');
    refreshCell.innerText = mc.RankHistory.SinceRefresh.toString();
    refreshCell.colSpan = bgs + 1;
    tbody.appendChild(createTableRow('Refresh', refreshCell));
    container.appendChild(table);
    return container;
}
function renderStateDump() {
    var dumpRoot = $x('stateDump');
    while (dumpRoot.hasChildNodes())
        dumpRoot.removeChild(dumpRoot.childNodes[0]);
    var mc = getOrCreateController();
    var bgs = 1 << mc.AddrCfg.BG;
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
    var cycleTableContainer = tableBody.parentElement;
    while (!cycleTableContainer.className)
        cycleTableContainer = cycleTableContainer.parentElement;
    cycleTableContainer.scrollTo({ top: cycleTableContainer.scrollHeight });
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
window.onunload = function () {
    localStorage.setItem(stateKey, JSON.stringify(saveState()));
};
loadState(JSON.parse(localStorage.getItem(stateKey)));
$x('bgBits').dispatchEvent(new Event("change"));
//# sourceMappingURL=script.js.map