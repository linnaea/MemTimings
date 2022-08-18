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
    return MemCommand;
}());
var MemoryController = /** @class */ (function () {
    function MemoryController(tCL, tCWL, tRCD, tRP, tRAS, tRC, tRRDs, tRRDl, tFAW, tWTRs, tWTRl, tWR, tRTP, tCCDl, tCCDs, tREFI, tRFC, tCR, gdm, x16) {
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
        this.groupHistory = [new CommandHistory(), new CommandHistory(), new CommandHistory(), new CommandHistory(),];
        this.bankCommandQueue = [
            new CommandQueue(), new CommandQueue(), new CommandQueue(), new CommandQueue(),
            new CommandQueue(), new CommandQueue(), new CommandQueue(), new CommandQueue(),
            new CommandQueue(), new CommandQueue(), new CommandQueue(), new CommandQueue(),
            new CommandQueue(), new CommandQueue(), new CommandQueue(), new CommandQueue(),
        ];
        this.bankHistory = [
            new CommandHistory(), new CommandHistory(), new CommandHistory(), new CommandHistory(),
            new CommandHistory(), new CommandHistory(), new CommandHistory(), new CommandHistory(),
            new CommandHistory(), new CommandHistory(), new CommandHistory(), new CommandHistory(),
            new CommandHistory(), new CommandHistory(), new CommandHistory(), new CommandHistory(),
        ];
        this.bankState = [
            new BankState(), new BankState(), new BankState(), new BankState(),
            new BankState(), new BankState(), new BankState(), new BankState(),
            new BankState(), new BankState(), new BankState(), new BankState(),
            new BankState(), new BankState(), new BankState(), new BankState(),
        ];
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
    Object.defineProperty(MemoryController.prototype, "DqAddress", {
        get: function () {
            if (!this.dqActive)
                return null;
            var addr = this.dqActive[4];
            addr |= this.dqActive[3] << 10;
            addr |= this.dqActive[2] << 12;
            addr |= this.dqActive[1] << (this.x16Mode ? 13 : 14);
            return addr;
        },
        enumerable: false,
        configurable: true
    });
    MemoryController.prototype.EnqueueCommand = function (cmd) {
        this.imcCommandQueue.push(cmd);
    };
    MemoryController.prototype.maybeEnqueueRefresh = function () {
        if (this.bankCommandQueue.every(function (q) { return q.Empty; })) {
            var preCommand_1 = new MemCommand(MemCommandEnum.PRE, 0, 0);
            preCommand_1.AutoPrecharge = true;
            var refreshCommand_1 = new MemCommand(MemCommandEnum.REF, 0, 0);
            if (!this.bankCommandQueue.every(function (q) { return q.OpenRow === null; })) {
                this.bankCommandQueue.forEach(function (q) { return q.QueueCommand(preCommand_1); });
            }
            this.bankCommandQueue.forEach(function (q) { return q.QueueCommand(refreshCommand_1); });
        }
    };
    MemoryController.prototype.scheduleDqs = function (cmd, dryRun) {
        var delay = ((cmd.Command === MemCommandEnum.READ) ? this.tCL : this.tCWL) + this.tCR - 1;
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
            return false;
        if (dryRun)
            return true;
        if (nextDqs)
            nextDqs.Preamble = nextNeedsPreamble ? nextPreamble : 0;
        this.dqsSchedule.splice(i, 0, new DqsSchedule(delay, this.bankState[cmd.BankNum].CurrentOpenRow, cmd, needsPreamble ? preamble : 0));
        return true;
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
        var bankState = this.bankState[cmd.BankNum];
        var bankHistory = this.bankHistory[cmd.BankNum];
        var groupHistory = this.groupHistory[cmd.BankGroup];
        cmd.NotLatched = this.tCR - 1;
        this.currentCommand = cmd;
        switch (cmd.Command) {
            case MemCommandEnum.REF:
                this.sinceRefresh -= this.tREFI;
                for (var i = 0; i < MemoryController.BANKS; i++) {
                    this.bankState[i].State = BankStateEnum.Refreshing;
                    this.bankState[i].StateCycles = 1 - this.tCR;
                }
                break;
            case MemCommandEnum.PRE:
                if (!cmd.AutoPrecharge) {
                    bankState.State = BankStateEnum.Precharging;
                    bankState.StateCycles = 1 - this.tCR;
                    bankState.CurrentOpenRow = null;
                }
                else {
                    for (var i = 0; i < MemoryController.BANKS; i++) {
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
        this.sinceRefresh++;
        this.rankHistory.doCycle();
        this.groupHistory.forEach(function (v) { return v.doCycle(); });
        this.bankHistory.forEach(function (v) { return v.doCycle(); });
        this.bankState.forEach(function (v) { return v.doCycle(); });
        this.dqsSchedule.forEach(function (v) { return v.DueCycles--; });
        for (var i = 0; i < this.fawTracking.length; i++) {
            this.fawTracking[i]++;
        }
        if (this.fawTracking.length && this.fawTracking[0] >= this.tFAW) {
            this.fawTracking.shift();
        }
        for (var i = 0; i < MemoryController.BANKS; i++) {
            var bankState = this.bankState[i];
            var bankHistory = this.bankHistory[i];
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
                var imcCommand = this.imcCommandQueue.shift();
                var _a = MemoryController.MapAddress(imcCommand.Address, this.x16Mode), bankNum = _a[0], row = _a[1], column = _a[2];
                var bankQueue = this.bankCommandQueue[bankNum];
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
        var canIssue = [];
        for (var i = 0; i < MemoryController.BANKS; i++) {
            var bankState = this.bankState[i];
            var bankHistory = this.bankHistory[i];
            var groupHistory = this.groupHistory[i >> 2];
            canIssue.push(!this.gearDown || (this.tCR & 1) == (this.currentCycle & 1));
            canIssue[i] && (canIssue[i] = this.currentCommand === null);
            if (!this.bankCommandQueue[i].Empty) {
                var cmd = this.bankCommandQueue[i].FirstCommand;
                switch (cmd.Command) {
                    case MemCommandEnum.ACT:
                        canIssue[i] && (canIssue[i] = bankState.State === BankStateEnum.Idle);
                        canIssue[i] && (canIssue[i] = bankHistory.SinceActivate + this.tCR > this.tRC);
                        canIssue[i] && (canIssue[i] = groupHistory.SinceActivate + this.tCR > this.tRRDl);
                        canIssue[i] && (canIssue[i] = this.rankHistory.SinceActivate + this.tCR > this.tRRDs);
                        canIssue[i] && (canIssue[i] = this.fawTracking.length < 4);
                        break;
                    case MemCommandEnum.REF:
                        canIssue[i] && (canIssue[i] = bankState.State === BankStateEnum.Idle);
                        canIssue[i] && (canIssue[i] = bankHistory.SinceActivate + this.tCR > this.tRC);
                        break;
                    case MemCommandEnum.PRE:
                        canIssue[i] && (canIssue[i] = bankState.State === BankStateEnum.Active || cmd.AutoPrecharge);
                        canIssue[i] && (canIssue[i] = bankState.State !== BankStateEnum.Refreshing);
                        canIssue[i] && (canIssue[i] = bankState.State !== BankStateEnum.Activating);
                        canIssue[i] && (canIssue[i] = !bankState.WriteTxs);
                        canIssue[i] && (canIssue[i] = bankHistory.SinceActivate + this.tCR > this.tRAS);
                        canIssue[i] && (canIssue[i] = bankHistory.SinceRead + this.tCR > this.tRTP);
                        canIssue[i] && (canIssue[i] = bankHistory.SinceWriteData + this.tCR > this.tWR);
                        break;
                    case MemCommandEnum.READ:
                        canIssue[i] && (canIssue[i] = bankState.State === BankStateEnum.Active);
                        canIssue[i] && (canIssue[i] = !bankState.WriteTxs);
                        canIssue[i] && (canIssue[i] = groupHistory.SinceRead + this.tCR > this.tCCDl);
                        canIssue[i] && (canIssue[i] = groupHistory.SinceWrite + this.tCR > this.tCCDl);
                        canIssue[i] && (canIssue[i] = groupHistory.SinceWriteData + this.tCR > this.tWTRl);
                        canIssue[i] && (canIssue[i] = this.rankHistory.SinceRead + this.tCR > this.tCCDs);
                        canIssue[i] && (canIssue[i] = this.rankHistory.SinceWrite + this.tCR > this.tCCDs);
                        canIssue[i] && (canIssue[i] = this.rankHistory.SinceWriteData + this.tCR > this.tWTRs);
                        canIssue[i] && (canIssue[i] = this.scheduleDqs(cmd, true));
                        break;
                    case MemCommandEnum.WRITE:
                        canIssue[i] && (canIssue[i] = bankState.State === BankStateEnum.Active);
                        canIssue[i] && (canIssue[i] = groupHistory.SinceRead + this.tCR > this.tCCDl);
                        canIssue[i] && (canIssue[i] = groupHistory.SinceWrite + this.tCR > this.tCCDl);
                        canIssue[i] && (canIssue[i] = this.rankHistory.SinceRead + this.tCR > this.tCCDs);
                        canIssue[i] && (canIssue[i] = this.rankHistory.SinceWrite + this.tCR > this.tCCDs);
                        canIssue[i] && (canIssue[i] = this.scheduleDqs(cmd, true));
                        break;
                }
            }
        }
        var allBankCommand = false;
        if (canIssue.every(function (v) { return v; })) {
            if (this.bankCommandQueue.every(function (v) { return !v.Empty && v.FirstCommand.Command === MemCommandEnum.PRE; })) {
                this.issuePrechargeAllBanks();
                allBankCommand = true;
            }
            if (this.bankCommandQueue.every(function (v) { return !v.Empty && v.FirstCommand.Command === MemCommandEnum.REF; })) {
                this.issueRefresh();
                allBankCommand = true;
            }
            if (allBankCommand) {
                this.bankCommandQueue.forEach(function (v) { return v.DequeueCommand(); });
            }
        }
        if (!allBankCommand) {
            for (var i = 0; i < MemoryController.BANKS; i++) {
                if (this.bankCommandQueue[i].Empty)
                    continue;
                if (!canIssue[i])
                    continue;
                var cmd = this.bankCommandQueue[i].FirstCommand;
                if (cmd.Command === MemCommandEnum.PRE && cmd.AutoPrecharge)
                    continue;
                if (cmd.Command === MemCommandEnum.REF)
                    continue;
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
            var dqs = this.dqsSchedule[0];
            switch (dqs.DueCycles) {
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
    };
    MemoryController.MapAddress = function (addr, x16) {
        var column = addr & 0x3F8;
        addr >>>= 10;
        var bankNum = addr & (x16 ? 0x7 : 0xF);
        var row = addr >> (x16 ? 3 : 4);
        return [bankNum, row, column];
    };
    MemoryController.BANKS = 16;
    return MemoryController;
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
        this.StateCycles++;
    };
    return BankState;
}());
var CommandQueue = /** @class */ (function () {
    function CommandQueue() {
        this.queue = [];
        this.openRow = null;
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
        this.SinceRead++;
        this.SinceWrite++;
        this.SinceWriteData++;
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
function $x(e) { return document.getElementById(e); }
function toHex(v, len) {
    var s = v.toString(16).toUpperCase();
    while (s.length < len)
        s = '0' + s;
    return s;
}
var stateKey = 'SAVE';
var cmdTable = Array.prototype.slice.apply($x('cmdTable').childNodes).filter(function (v) { return v.tagName === "TBODY"; })[0];
var allTimings = ['tCL',
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
function saveState(imcCommands) {
    var timings = {};
    for (var i = 0; i < allTimings.length; i++) {
        var ele = $x(allTimings[i]);
        var val = ele.value;
        if (ele.type === "checkbox")
            val = ele.checked;
        if (ele.type === "number")
            val = parseInt(ele.value);
        timings[allTimings[i]] = val;
    }
    localStorage.setItem(stateKey, JSON.stringify({
        timings: timings,
        commands: imcCommands
    }));
}
function loadState() {
    var _a;
    var state = JSON.parse(localStorage.getItem(stateKey));
    if (state === null || state === void 0 ? void 0 : state.timings) {
        for (var i = 0; i < allTimings.length; i++) {
            var val = state === null || state === void 0 ? void 0 : state.timings[allTimings[i]];
            if (val === undefined)
                continue;
            var ele = $x(allTimings[i]);
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
                var _b = addCmdRow(), ci = _b[0], rw = _b[1], ai = _b[2];
                ci.value = (1 + cmd.Cycle).toString();
                rw.checked = !!cmd.IsWrite;
                ai.value = toHex(cmd.Address, 8);
            }
        }
    }
    else {
        addCmdRow();
    }
}
$x('go').onclick = function () {
    var _a;
    var cycleTable = $x('cycleTable');
    var tableBody = document.createElement('tbody');
    for (var i = 0; i < cycleTable.childNodes.length; i++) {
        if (cycleTable.childNodes[i].tagName === "THEAD")
            continue;
        cycleTable.removeChild(cycleTable.childNodes[i]);
        i--;
    }
    cycleTable.appendChild(tableBody);
    var mc = new MemoryController(parseInt($x('tCL').value), parseInt($x('tCWL').value), parseInt($x('tRCD').value), parseInt($x('tRP').value), parseInt($x('tRAS').value), parseInt($x('tRC').value), parseInt($x('tRRDs').value), parseInt($x('tRRDl').value), parseInt($x('tFAW').value), parseInt($x('tWTRs').value), parseInt($x('tWTRl').value), parseInt($x('tWR').value), parseInt($x('tRTP').value), parseInt($x('tCCDl').value), parseInt($x('tCCDs').value), parseInt($x('tREFI').value), parseInt($x('tRFC').value), parseInt($x('tCR').value), $x('gearDown').checked, $x('x16').checked);
    mc.UseAutoPrecharge = !!$x('useAP').checked;
    var cycles = parseInt($x('cycles').value);
    var allCycles = $x('allCycles').checked;
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
    saveState(imcCommands);
    var outputDesCycle = true;
    for (var i = 0; i < cycles; i++) {
        while (imcCommands.length && imcCommands[0].Cycle === mc.CurrentCycle) {
            mc.EnqueueCommand(imcCommands.shift());
        }
        mc.DoCycle();
        outputDesCycle || (outputDesCycle = mc.DqsActive);
        var row = void 0;
        if (mc.CurrentCommand) {
            row = document.createElement('tr');
            tableBody.appendChild(row);
            var cell = document.createElement('td');
            cell.innerText = mc.CurrentCycle.toString();
            row.appendChild(cell);
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
            outputDesCycle = true;
        }
        else if (outputDesCycle || allCycles) {
            row = document.createElement('tr');
            tableBody.appendChild(row);
            var cell = document.createElement('td');
            cell.innerText = mc.CurrentCycle.toString();
            row.appendChild(cell);
            cell = document.createElement('td');
            cell.colSpan = 10;
            cell.className = 'inactive';
            row.appendChild(cell);
            outputDesCycle = false;
        }
        if (row) {
            var cell = document.createElement('td');
            cell.innerText = mc.DqsActive ? "\u2B5C\u2B5D" : '';
            if (mc.DqsActive) {
                cell.className = mc.DqActive ? 'active' : 'latching';
            }
            else {
                cell.className = 'inactive';
            }
            row.appendChild(cell);
            var dq = ['', ''];
            dq[0] = (mc.DqActive && mc.DqActive[0] === MemCommandEnum.READ) ? 'R' : 'W';
            dq[1] = toHex((_a = mc.DqAddress) !== null && _a !== void 0 ? _a : 0, 8);
            cell = document.createElement('td');
            cell.innerText = mc.DqActive ? dq.join(' ') : '';
            cell.className = mc.DqActive ? 'active' : 'inactive';
            row.appendChild(cell);
            if (mc.DqActive || mc.DqsActive)
                outputDesCycle = true;
        }
    }
};
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
        var _a = MemoryController.MapAddress(addr, $x('x16').checked), bankNum = _a[0], aRow = _a[1], col = _a[2];
        var bankGroup = bankNum >> 2;
        var bank = bankNum & 3;
        mapAddrCell.innerText = "".concat(bankGroup, "/").concat(bank, "/").concat(toHex(aRow, 5), "/").concat(toHex(col, 3));
        if (!row.isConnected) {
            $x('x16').removeEventListener('change', updateMapAddr);
        }
    }
    addrInput.onkeyup = updateMapAddr;
    $x('x16').addEventListener('change', updateMapAddr);
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
        $x('x16').removeEventListener('change', updateMapAddr);
    };
    cell.appendChild(delButton);
    row.appendChild(cell);
    cmdTable.appendChild(row);
    return [cycleInput, rwInput, addrInput];
}
loadState();
//# sourceMappingURL=script.js.map