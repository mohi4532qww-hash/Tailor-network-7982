import { AlertTriangle } from "lucide-react";
import React, { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_LINES_REF } from "./features_departments_managerHelpers.js";
import { AppContext } from "./context_AppContext.js";
import { AppHeader } from "./components_AppHeader.jsx";
import { Approvals } from "./features_approvals_Approvals.jsx";
import { BOTTOM_NAV, NAV_ITEMS } from "./core_navConfig.js";
import { ConnectCompanyPanel } from "./features_connect_ConnectCompanyPanel.jsx";
import { Dashboard } from "./features_dashboard_Dashboard.jsx";
import { Departments } from "./features_departments_Departments.jsx";
import { GlobalStyles } from "./styles_GlobalStyles.jsx";
import { INIT_STYLE_FILES, Styles } from "./features_styles_StyleFiles.jsx";
import { LoginPage } from "./features_auth_LoginPage.jsx";
import { MOCK_DB, PERSISTED, TWE_MOCK_KEY, TWE_STATE_KEY, _lastStateJson, saveMockParts, scopedByCompany, setLastStateJson, sweepTeamRequests, twStore } from "./data_store.js";
import { ManagerPanel } from "./features_manager_ManagerPanel.jsx";
import { NavIcon } from "./components_icons_IconAliases.jsx";
import { Operations } from "./features_operations_Operations.jsx";
import { PDF_BRAND } from "./features_export_pdfExport.js";
import { SUB_BLOCK_MSG, SUB_DATA, SUB_LIVE, SUB_SHIFT_KEY, getSubscription, subGate, subLiveRefresh, subSync } from "./features_subscription_subscriptionEngine.js";
import { TWES_DEMO_MODE, TWES_FRONTEND_SECURITY, clearLoginGuard, readSecureSessionUser, touchSecureSession, twSession, writeSecureSessionUser } from "./lib_security.js";
import { TailorPanel } from "./features_tailor_TailorPanel.jsx";
import { ToastProvider } from "./components_Toast.jsx";
import { WorkEntryPanel } from "./features_workentry_WorkEntryPanel.jsx";
import { WorkReport } from "./features_reports_WorkReport.jsx";
import { calculateEntryAmount, getEntryPieces, getEntryRate, isCountedEntry, normalizeNewEntry } from "./lib_calc.js";
import { checkAllocationForEntry, cycleLockIdForDate, isWorkerInDept, migrateAllocations, opLineById, opLineIdById, sameCompany } from "./features_allocation_allocation.js";
import { getCycleByKey, getCycleForDate, getCycleOptions, isCycleGraceExpired } from "./lib_cycles.js";
import { remapAllocations } from "./features_allocation_remapAllocations.js";
import { stripSecrets, toLocalYMD, uid } from "./lib_ids-and-crypto.js";

// Tailor Record <-> Salary Report ka switch ab green header mein hai (HdrReportSwitch).
// Yahan sirf Salary Report page par cycle (date) wali patti dikhti hai.
function AppInner() {
    // SECURITY NOTE: session (stripSecrets ke baad, PIN hash ke bina) localStorage mein rehti hai taaki app band hone par login bana rahe;
    // 30 din idle/max expiry, logout par delete, aur dusre tab ke logout par turant logout. Asli auth backend (httpOnly cookie) ka kaam hai.
    const [user, setUser] = useState(() => readSecureSessionUser());
    PDF_BRAND.company = (user && user.tenantName) || "";
    const [page, setPage] = useState(() => {
        const u = readSecureSessionUser();
        return u?.role === "tailor" ? "self-entry" : "departments";
    });
    // Fix: keyboard pushing up bottom nav on mobile
    useEffect(() => {
        const meta = document.querySelector("meta[name=viewport]");
        if (meta)
            meta.content = "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-visual";
    }, []);
    // Tap effect: kisi bhi button / link / tappable par touch point se soft green ripple
    useEffect(() => {
        const onDown = (e) => {
            try {
                const t = e.target && e.target.closest ? e.target.closest("button, a, [role=button], .tw-tap") : null;
                if (!t || t.disabled || t.getAttribute("aria-disabled") === "true")
                    return;
                const r = document.createElement("span");
                r.className = "tw-ripple";
                r.style.left = e.clientX + "px";
                r.style.top = e.clientY + "px";
                document.body.appendChild(r);
                setTimeout(() => { try {
                    r.remove();
                }
                catch (_) { } }, 520);
            }
            catch (_) { }
        };
        document.addEventListener("pointerdown", onDown, { passive: true });
        return () => document.removeEventListener("pointerdown", onDown);
    }, []);
    const [pageHistory, setPageHistory] = useState([]);
    const [navMenuOpen, setNavMenuOpen] = useState(false); // header hamburger -> side menu
    // Local sub-view back override — jab koi page ke andar apna list/detail
    // sub-navigation rakhta hai (jaise Styles list→detail), wo yahan apna
    // "close detail" handler register kar sakta hai. Floating back button
    // pehle isko try karega, warna page-level goBack() chalega.
    const [localBackHandler, setLocalBackHandler] = useState(null);
    const [, setSidebarOpen] = useState(false);
    const [autoOpenAdd, setAutoOpenAdd] = useState(null); // "workers" | "styles" | "operations" — Settings submenu se direct Add modal kholne ke liye
    const [workDeptName, setWorkDeptName] = useState(null); // Home par department card click — us department ka Work Entry
    const [autoSelectStyleId, setAutoSelectStyleId] = useState(null); // style id — Dashboard card click se Styles detail kholne ke liye
    // ══════════════════════════════════════════
    // SHARED GLOBAL STATE — all panels connected
    // ══════════════════════════════════════════
    const [sharedEntries, setSharedEntries] = useState((PERSISTED?.entries || MOCK_DB.workEntries).filter(e => e && e.status !== "rejected").map(e => ({ ...e, status: "approved" })) // rejected entries delete; koi pending state nahi
    );
    // Race-proof ref — addEntry() isse turant (synchronously) latest entries padhta hai,
    // taaki double-tap/rapid-submit se Work Cycle Allocation check stale data par pass na ho jaaye.
    const sharedEntriesRef = useRef(sharedEntries);
    useEffect(() => { sharedEntriesRef.current = sharedEntries; }, [sharedEntries]);
    const [sharedWorkers, setSharedWorkers] = useState(() => PERSISTED?.workers || MOCK_DB.workers);
    // Tailor ke personal Self Entry notes — sharedEntries se alag; Admin reports/allocation/payment mein count nahi hote
    const [selfNotes, setSelfNotes] = useState(() => Array.isArray(PERSISTED?.selfNotes) ? PERSISTED.selfNotes : []);
    // Tailor ka personal Advance record (Personal Note mode) — ye bhi sirf tailor ke liye, Admin ko nahi dikhta
    const [selfAdvances, setSelfAdvances] = useState(() => Array.isArray(PERSISTED?.selfAdvances) ? PERSISTED.selfAdvances : []);
    // Har style ke saath uske configured operations (opNames) — Allocation + Work Entry isi se operations nikalte hain
    const [sharedStyles, setSharedStyles] = useState(() => (PERSISTED?.styles || MOCK_DB.styles).map(st => Array.isArray(st.opNames) ? st : {
        ...st, opNames: ((INIT_STYLE_FILES.find(f => f.styleCode === (st.styleNumber || st.styleCode)) || {}).processes || []).map(pr => pr.name),
    })); // admin creates sab panels mein sync
    // Worker Line enrollment map: { workerId: [lineId, lineId2, ...] }
    // Work Entry panel ke "Team" tab se workers add hote hain — tabhi worker ko access milta hai
    const [workerLineMap, setWorkerLineMap] = useState(PERSISTED?.workerLineMap || {
        "w1": ["d1"], // Sandeep Shing Stitching
        "w2": ["d1"], // Parmod Kumar Stitching
        "w3": ["d1"], // Rajan Kumar Stitching
        "w4": ["d1"], // Nikhil Kumar Stitching
        "w5": ["d1"], // Alok Kumar Stitching
        "w6": ["d1"], // Lalit Kumar Stitching
        "w7": ["d1"], // Balkrishn Shing Stitching
        "w8": ["d1"], // Vibha Shing Stitching
        "w9": ["d1"], // Sanjeev Gupta Stitching
    });
    // Style-based Allocation (Style → Department → Cycle → Quantity) — lifted to App level so Work Entry can enforce it
    // Record: {id, companyId, styleId, department, cycleKey, cycleLabel, allocatedQty, remarks, createdAt} — operationId nahi
    const [sharedDeptAllocations, setSharedDeptAllocations] = useState(() => {
        if (PERSISTED?.deptAllocations)
            return migrateAllocations(PERSISTED.deptAllocations, PERSISTED.styles || MOCK_DB.styles, PERSISTED.lines || MOCK_DB.lines, PERSISTED.cycleType);
        // Demo seed: Stitching department ki allocation — current cycle + jin cycles mein demo entries hain (style qty barabar baant ke)
        const seedCycles = {}; // styleId -> {cycleKey: cycle}
        const curC = getCycleForDate(toLocalYMD(), "15days");
        MOCK_DB.styles.forEach(st => { seedCycles[st.id] = { [curC.key]: curC }; });
        MOCK_DB.workEntries.forEach(e => { const c = getCycleForDate(e.date, "15days"); if (c && seedCycles[e.styleId])
            seedCycles[e.styleId][c.key] = c; });
        const out = [];
        MOCK_DB.styles.forEach(st => {
            const cycles = Object.values(seedCycles[st.id]);
            // Style qty combos aur cycles mein baant di (total = style qty); combo ke operations ko us combo ki qty milti hai
            const slots = [];
            (st.combos || []).forEach(cb => cycles.forEach(c => slots.push({ cb, c })));
            const totalQ = Number(st.totalQuantity) || 0, unit = Math.floor(totalQ / Math.max(1, slots.length));
            slots.forEach(({ cb, c }, si) => out.push({ id: `da_${st.id}_${cb.id}_${c.key}`, companyId: st.companyId || "c1", styleId: st.id, department: "Stitching", operationId: null, cycleKey: c.key, cycleLabel: c.label, comboId: cb.id, comboName: cb.name, comboOps: cb.opNames, allocatedQty: unit + (si === slots.length - 1 ? totalQ - unit * slots.length : 0), remarks: "", createdAt: new Date().toISOString() }));
        });
        return out;
    });
    const [sharedLines, setSharedLines] = useState(PERSISTED?.lines || MOCK_DB.lines.map(d => ({ ...d }))); // Lifted line state — shared across WorkersLines
    ALL_LINES_REF.current = sharedLines;
    // Company-scoped settings. Purane v1 demo data ka single global setting bhi
    // migrate hota hai, lekin ab har company ka cycle/grace independently saved rahega.
    const initialCompanyId = readSecureSessionUser()?.companyId || MOCK_DB.currentUser?.companyId || "";
    const [companySettings, setCompanySettings] = useState(() => {
        const saved = (PERSISTED && PERSISTED.companySettings && typeof PERSISTED.companySettings === "object")
            ? PERSISTED.companySettings : {};
        if (initialCompanyId && !saved[initialCompanyId]) {
            saved[initialCompanyId] = {
                cycleType: PERSISTED?.cycleType || "15days",
                graceDays: PERSISTED?.graceDays ?? 3,
            };
        }
        return saved;
    });
    const initialSettings = companySettings[initialCompanyId] || { cycleType: "15days", graceDays: 3 };
    const [globalCycleType, setGlobalCycleTypeState] = useState(initialSettings.cycleType);
 // eslint-disable-line react-hooks/exhaustive-deps
    const [entryGraceDays, setEntryGraceDaysState] = useState(initialSettings.graceDays);
    // Global Work Cycle filter (header se) — poori app ek hi selected cycle follow karti hai
    const appCycles = useMemo(() => getCycleOptions(globalCycleType, 24), [globalCycleType]);
    const [appCycleKeyRaw, setAppCycleKey] = useState("");
    const appCycleKey = appCycles.some(c => c.key === appCycleKeyRaw) ? appCycleKeyRaw : (appCycles[0]?.key || "");
    // Public setters keep existing UI/API names, but write only the logged-in
    // company's setting.
    const setGlobalCycleType = useCallback((value) => {
        setGlobalCycleTypeState(prev => {
            const next = typeof value === "function" ? value(prev) : value;
            if (user?.companyId)
                setCompanySettings(cs => ({
                    ...cs, [user.companyId]: { ...(cs[user.companyId] || { cycleType: "15days", graceDays: 3 }), cycleType: next }
                }));
            return next;
        });
    }, [user?.companyId]);
    const setEntryGraceDays = useCallback((value) => {
        setEntryGraceDaysState(prev => {
            const next = typeof value === "function" ? value(prev) : value;
            if (user?.companyId)
                setCompanySettings(cs => ({
                    ...cs, [user.companyId]: { ...(cs[user.companyId] || { cycleType: "15days", graceDays: 3 }), graceDays: next }
                }));
            return next;
        });
    }, [user?.companyId]);
    // Company Profile (city / garment type) — TWES Connect Search mein isi se company dikhti hai
    const updateCompanyProfile = useCallback((patch) => {
        if (!user?.companyId)
            return;
        setCompanySettings(cs => ({ ...cs, [user.companyId]: { ...(cs[user.companyId] || { cycleType: "15days", graceDays: 3 }), ...patch } }));
    }, [user?.companyId]);
    // Login/switch par selected company's settings load karo.
    useEffect(() => {
        if (!user?.companyId)
            return;
        const s = companySettings[user.companyId] || { cycleType: "15days", graceDays: 3 };
        setGlobalCycleTypeState(s.cycleType);
        setEntryGraceDaysState(s.graceDays);
    }, [user?.companyId]);
    // Shared actions
    // Lock check — add / edit / delete teeno ke liye ek hi jagah:
    // grace-period expiry (manual lock nahi hai)
    const entryLockMessage = (dateStr) => {
        if (!dateStr)
            return null;
        const cid = cycleLockIdForDate(dateStr, globalCycleType);
        if (isCycleGraceExpired(cid, entryGraceDays))
            return "Is cycle ka grace period khatam ho chuka hai — entry add/edit/delete allowed nahi.";
        return null;
    };
    // Worker ko is department ki entry mil sakti hai? (active + enrolled) — add aur edit dono yahin se guzarte hain
    const workerEntryBlockMessage = (worker, dept, companyId, lineId) => {
        if (!worker)
            return "Tailor nahi mila — entry nahi ho sakti.";
        if (worker.status !== "active")
            return `"${worker.name}" ab active nahi hai — entry nahi ho sakti.`;
        if ((dept || lineId) && !isWorkerInDept(worker, dept, sharedLines, workerLineMap, companyId, lineId))
            return `"${worker.name}" "${dept}" department mein enrolled nahi hai. Pehle Team → Add Member se is department mein add karo.`;
        return null;
    };
    const findWorkerFor = (workerId, companyId) => (sharedWorkers || []).find(x => x.id === workerId && sameCompany(x, companyId));
    // Tailor sirf apni entry chhoo sakta hai; department manager sirf apni department ki entries
    const tailorEntryBlock = (e) => {
        if (!e)
            return null;
        if (user?.role === "tailor")
            return e.workerId === user.workerId ? null : "Aapko is entry ka access nahi hai.";
        if (user?.role === "manager")
            return ((e.lineId && e.lineId === user.lineId) || (e.line || e.department) === user.line) ? null : "Ye entry aapki department ki nahi hai.";
        return null;
    };
    // Closed style ki entries na add, na edit, na delete — pehle style Reopen karo
    const STYLE_CLOSED_EDIT_MSG = "Ye style Closed hai — isme entry edit/delete nahi ho sakti. Pehle style Reopen karo.";
    // Galat / purani id par edit-delete "success" na dikhe — entry mili hi nahi to saaf message do
    const ENTRY_MISSING_MSG = "Ye entry ab nahi mili — shayad pehle hi delete ho chuki hai. Screen refresh karke dobara dekho.";
    const isStyleClosedById = (sid) => String(((sharedStyles || []).find(st => st.id === sid) || {}).status || "").toLowerCase() === "closed";
    const sharedActions = {
        // Entry submit hote hi seedhe approved ho jaati hai — koi approval step nahi
        addEntry: (rawEntry) => {
            // Central normalisation: numeric pieces/rate, operation ka department, Amount = Pieces × Rate
            const entry = normalizeNewEntry(rawEntry, MOCK_DB.operations);
            // Har entry company-scoped — caller bhoole bhi to companyId yahin stamp ho jaata hai
            entry.companyId = entry.companyId || user?.companyId;
            const accessMsg = tailorEntryBlock(entry);
            if (accessMsg)
                return { success: false, message: accessMsg };
            if (subGate(entry.companyId).blocked)
                return { success: false, message: SUB_BLOCK_MSG }; // bill pending + grace khatam — entry band
            // Future date ki entry nahi (UI ke max ke alawa logic level par bhi)
            if (entry.date && entry.date > toLocalYMD()) {
                return { success: false, message: "Future date ki entry nahi ho sakti." };
            }
            // Closed style par nayi entry nahi
            const entryStyle = (sharedStyles || []).find(st => st.id === entry.styleId);
            // Company isolation — style / operation doosri company ka nahi ho sakta
            if (entryStyle && !sameCompany(entryStyle, entry.companyId))
                return { success: false, message: "Ye style aapki company ki nahi hai." };
            const entryOp = (MOCK_DB.operations || []).find(o => o.id === entry.operationId);
            if (entryOp && !sameCompany(entryOp, entry.companyId))
                return { success: false, message: "Ye operation aapki company ka nahi hai." };
            if (entryStyle && String(entryStyle.status).toLowerCase() === "closed") {
                return { success: false, message: "Ye style Closed hai — isme nayi entry nahi ho sakti." };
            }
            // Piece rate zaruri hai — rate 0 ho to ₹0 ki entry nahi banegi
            if (!(getEntryRate(entry) > 0)) {
                return { success: false, message: `"${entry.operation || (entryOp && entryOp.name) || "Operation"}" ka piece rate set nahi hai — pehle rate daalo, phir entry karo.` };
            }
            const lockMsg = entryLockMessage(entry.date);
            if (lockMsg)
                return { success: false, message: lockMsg };
            // Worker check — active ho aur is department mein enrolled ho
            const entryCompanyId = entry.companyId || user?.companyId;
            const workerMsg = workerEntryBlockMessage(findWorkerFor(entry.workerId, entryCompanyId), entry.line, entryCompanyId, entry.lineId);
            if (workerMsg)
                return { success: false, message: workerMsg };
            // Ek worker ki ek style + operation mein ek cycle mein sirf ek entry — ye rule ab yahin (central) bhi enforce hota hai, sirf form mein nahi
            const dupCyc = getCycleForDate(entry.date, globalCycleType);
            const dupExisting = dupCyc && (sharedEntriesRef.current || []).find(e => e.id !== entry.id && isCountedEntry(e) && sameCompany(e, entryCompanyId)
                && e.workerId === entry.workerId && e.styleId === entry.styleId && e.operationId === entry.operationId
                && e.date >= dupCyc.start && e.date <= dupCyc.end);
            if (dupExisting)
                return { success: false, message: "Is worker ki is style + operation mein is cycle ki entry pehle se hai — badalne ke liye us entry ko edit karo." };
            // Allocation check — Style + Department + Cycle ki allocation (sab operations ke liye same); is operation ki us cycle ki total entries ≤ allocation
            // (koi previous/next operation check nahi)
            // sharedEntriesRef.current (sync, hamesha up-to-date) use karte hain, na ki
            // sharedEntries closure — warna double-tap/rapid-submit mein doosra call stale
            // data dekh kar allocation limit paar kar sakta hai.
            const allocCheck = checkAllocationForEntry({
                deptAllocations: sharedDeptAllocations,
                sharedEntries: sharedEntriesRef.current,
                style: entryStyle,
                styleId: entry.styleId,
                department: entry.line, // normalizeNewEntry: operation ka department
                operationId: entry.operationId,
                date: entry.date,
                pieces: entry.pieces,
                globalCycleType,
                companyId: entry.companyId || user?.companyId,
            });
            if (!allocCheck.ok) {
                return { success: false, message: allocCheck.msg };
            }
            const now = new Date();
            const newEntry = {
                ...entry,
                id: entry.id || uid("we"),
                status: "approved", // koi pending/rejected state nahi — entry ya to approved hai ya delete
                submittedAt: now.toISOString(),
                submittedTime: now.toLocaleTimeString("en-IN"),
                submittedBy: entry.workerId || entry.workerName || "",
            };
            // duplicate avoid
            if (sharedEntriesRef.current.find(e => e.id === newEntry.id))
                return { success: true };
            // Ref ko turant (synchronously) update karo — agla addEntry() call chahe usi tick mein
            // ho, ye naya entry allocation-check mein turant count hoga.
            sharedEntriesRef.current = [newEntry, ...sharedEntriesRef.current];
            setSharedEntries(sharedEntriesRef.current);
            return { success: true };
        },
        // Admin edits an entry's pieces/amount
        updateEntry: (id, updates) => {
            // sharedEntriesRef.current hamesha latest hai (stale closure se bachne ke liye)
            const existing = sharedEntriesRef.current.find(e => e.id === id);
            if (!existing)
                return { success: false, message: ENTRY_MISSING_MSG };
            if (existing && !sameCompany(existing, user?.companyId))
                return { success: false, message: "Ye entry aapki company ki nahi hai." };
            if (existing && isStyleClosedById(existing.styleId))
                return { success: false, message: STYLE_CLOSED_EDIT_MSG };
            if (existing && updates && updates.styleId !== undefined && updates.styleId !== existing.styleId && isStyleClosedById(updates.styleId))
                return { success: false, message: STYLE_CLOSED_EDIT_MSG };
            const accessMsgU = existing ? (tailorEntryBlock(existing) || tailorEntryBlock({ ...existing, ...updates, line: updates.department || opLineById(updates.operationId) || existing.line, lineId: (updates.department ? (updates.lineId || existing.lineId) : (opLineIdById(updates.operationId) || existing.lineId)) })) : null;
            if (accessMsgU)
                return { success: false, message: accessMsgU };
            let finalUpdates = { ...updates };
            if (finalUpdates.status === "pending")
                finalUpdates.status = "approved"; // pending state exist nahi karti
            if (existing) {
                if (updates.date !== undefined && updates.date > toLocalYMD()) {
                    return { success: false, message: "Future date ki entry nahi ho sakti." };
                }
                const lockOld = entryLockMessage(existing.date);
                if (lockOld)
                    return { success: false, message: lockOld };
                if (updates.date !== undefined && updates.date !== existing.date) {
                    const lockNew = entryLockMessage(updates.date);
                    if (lockNew)
                        return { success: false, message: lockNew };
                }
                const merged = { ...existing, ...updates };
                // Worker ya operation (=department) badle tabhi enrollment dobara check — purani entry ka sirf pieces edit karna block nahi hota
                const workerChanged = updates.workerId !== undefined && updates.workerId !== existing.workerId;
                const opChanged = updates.operationId !== undefined && updates.operationId !== existing.operationId;
                if (workerChanged || opChanged) {
                    const cId = merged.companyId || user?.companyId;
                    const wMsg = workerEntryBlockMessage(findWorkerFor(merged.workerId, cId), merged.department || opLineById(merged.operationId) || merged.line, cId, (merged.department ? merged.lineId : (opLineIdById(merged.operationId) || merged.lineId)));
                    if (wMsg)
                        return { success: false, message: wMsg };
                }
                const touchesQty = updates.pieces !== undefined || updates.quantity !== undefined;
                const touchesRate = updates.pieceRate !== undefined || updates.rate !== undefined;
                if (touchesQty) {
                    const newPieces = updates.pieces !== undefined ? Number(updates.pieces) : Number(updates.quantity);
                    if (!Number.isFinite(newPieces) || newPieces <= 0) {
                        return { success: false, message: "Quantity 0 se zyada honi chahiye. Negative ya invalid quantity allowed nahi hai." };
                    }
                    finalUpdates.pieces = newPieces;
                    merged.pieces = newPieces;
                }
                // Edit se bhi wahi rule: ek worker + style + operation + cycle mein sirf ek entry (addEntry jaisa)
                const dupKeys = ["workerId", "styleId", "operationId", "date", "status"];
                if (isCountedEntry(merged) && dupKeys.some(k => updates[k] !== undefined && updates[k] !== existing[k])) {
                    const dCyc = getCycleForDate(merged.date, globalCycleType);
                    const dCid = merged.companyId || user?.companyId;
                    const dupHit = dCyc && sharedEntriesRef.current.find(e => e.id !== id && isCountedEntry(e) && sameCompany(e, dCid)
                        && e.workerId === merged.workerId && e.styleId === merged.styleId && e.operationId === merged.operationId
                        && e.date >= dCyc.start && e.date <= dCyc.end);
                    if (dupHit)
                        return { success: false, message: "Is worker ki is style + operation mein is cycle ki entry pehle se hai — dusri entry ke saath merge/edit karo." };
                }
                const touchesAlloc = touchesQty || ["styleId", "operationId", "status", "workerId", "date"].some(k => updates[k] !== undefined);
                if (touchesAlloc && isCountedEntry(merged)) {
                    // Purani entry (excludeEntryId) current total se hat kar nayi quantity validate hoti hai
                    const allocCheck = checkAllocationForEntry({
                        deptAllocations: sharedDeptAllocations,
                        sharedEntries: sharedEntriesRef.current,
                        style: (sharedStyles || []).find(st => st.id === merged.styleId),
                        styleId: merged.styleId,
                        department: merged.department || opLineById(merged.operationId) || merged.line,
                        operationId: merged.operationId,
                        date: merged.date,
                        pieces: getEntryPieces(merged),
                        globalCycleType,
                        excludeEntryId: id,
                        companyId: merged.companyId || user?.companyId,
                    });
                    if (!allocCheck.ok)
                        return { success: false, message: allocCheck.msg };
                }
                // Pieces ya rate badalne par Amount HAMESHA dobara calculate: Amount = Pieces × Piece Rate
                if (touchesQty || touchesRate || opChanged) {
                    let rate = +merged.pieceRate || +merged.rate || getEntryRate(existing) || 0;
                    if (opChanged && !touchesRate) {
                        // Operation badli aur caller ne rate nahi diya — naye operation ka rate (purana rate nahi)
                        const newOp = (MOCK_DB.operations || []).find(o => o.id === merged.operationId);
                        rate = +newOp?.pieceRate || rate;
                    }
                    if (!(rate > 0))
                        return { success: false, message: "Piece rate set nahi hai — rate daale bina entry save nahi ho sakti." };
                    finalUpdates.amount = calculateEntryAmount(getEntryPieces(merged), rate);
                    if (touchesRate || opChanged || !merged.pieceRate)
                        finalUpdates.pieceRate = rate;
                }
            }
            const editedAt = new Date().toISOString();
            const nextEntries = sharedEntriesRef.current.map(e => e.id === id ? { ...e, ...finalUpdates, editedAt, editedBy: updates.editedBy || user?.name || "" } : e);
            sharedEntriesRef.current = nextEntries;
            setSharedEntries(nextEntries);
            return { success: true, entry: nextEntries.find(e => e.id === id) };
        },
        // Admin deletes an entry
        deleteEntry: (id) => {
            const existing = sharedEntriesRef.current.find(e => e.id === id);
            if (!existing)
                return { success: false, message: ENTRY_MISSING_MSG };
            if (existing && !sameCompany(existing, user?.companyId))
                return { success: false, message: "Ye entry aapki company ki nahi hai." };
            if (existing && isStyleClosedById(existing.styleId))
                return { success: false, message: STYLE_CLOSED_EDIT_MSG };
            const accessMsgD = tailorEntryBlock(existing);
            if (accessMsgD)
                return { success: false, message: accessMsgD };
            if (existing) {
                const lockMsg = entryLockMessage(existing.date);
                if (lockMsg)
                    return { success: false, message: lockMsg };
            }
            // Ref ko bhi turant update karo — warna delete ke turant baad addEntry/updateEntry
            // purani ref list wapas state mein likh kar deleted entry ko resurrect kar sakta tha.
            const next = sharedEntriesRef.current.filter(e => e.id !== id);
            sharedEntriesRef.current = next;
            setSharedEntries(next);
            return { success: true };
        },
        // Admin adds worker
        addWorker: (worker) => {
            setSharedWorkers(prev => [...prev, { ...worker, id: uid("w"), status: "active" }]);
        },
        // Admin style CRUD sab panels sync
        addStyle: (style) => {
            setSharedStyles(prev => [{ ...style, companyId: style.companyId || user?.companyId }, ...prev]);
        },
        updateStyle: (id, updates) => {
            setSharedStyles(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
        },
    };
    // Work Cycle type badalna — allocations naye cycle keys mein convert hoti hain
    const changeCycleType = (newType) => {
        if (newType === globalCycleType)
            return { success: true };
        // Pehle poori remap calculate karo (latest entries ke saath); koi conflict ho to cycle change BLOCK — kuch bhi apply nahi hota.
        const companyId = user?.companyId;
        const companyAllocs = (sharedDeptAllocations || []).filter(a => sameCompany(a, companyId));
        const otherCompanyAllocs = (sharedDeptAllocations || []).filter(a => !sameCompany(a, companyId));
        const { allocs, conflicts } = remapAllocations(companyAllocs, newType, sharedEntriesRef.current);
        if (conflicts.length > 0) {
            const c = conflicts[0];
            const stName = (sharedStyles || []).find(x => x.id === c.alloc.styleId)?.styleName || "Style";
            const cycLabel = getCycleByKey(c.alloc.cycleKey)?.label || c.alloc.cycleKey;
            const more = conflicts.length > 1 ? ` (aur ${conflicts.length - 1} allocation mein bhi yahi dikkat hai)` : "";
            return {
                success: false,
                message: `Cycle abhi change nahi ho sakta: "${stName}" · ${c.alloc.department} · ${cycLabel} — pehle half mein ${c.need1} aur doosre half mein ${c.need2} pcs ki entries hain (jod ${c.need1 + c.need2}), par allocation sirf ${c.total} pcs hai. Pehle is allocation ko kam se kam ${c.need1 + c.need2} pcs karo${more}.`,
            };
        }
        setSharedDeptAllocations([...otherCompanyAllocs, ...allocs]);
        setGlobalCycleType(newType);
        return { success: true };
    };
    // ── Subscription: demo mein bill/ginti taza karna, live mein server se status lana ──
    const [, setSubVer] = useState(0);
    const subSigRef = useRef("");
    useEffect(() => {
        const cid = user?.companyId;
        if (!cid || SUB_LIVE)
            return;
        SUB_DATA.workers = sharedWorkers;
        SUB_DATA.entries = sharedEntries;
        if (subSync(cid))
            setSubVer(v => v + 1);
    }, [user?.companyId, sharedWorkers, sharedEntries]);
    useEffect(() => {
        const cid = user?.companyId;
        if (!cid)
            return;
        const run = async () => {
            let changed = false;
            if (SUB_LIVE) {
                try {
                    await subLiveRefresh(cid);
                    changed = true;
                }
                catch (e) { /* purana status chalega (SUB_STALE_HOURS tak) */ }
            }
            else
                changed = subSync(cid);
            const s = getSubscription(cid);
            const sig = [s.known, s.blocked, s.inGrace, s.graceLeft, s.openTotal, s.inFree, s.freeLeft].join("|");
            if (changed || sig !== subSigRef.current) {
                subSigRef.current = sig;
                setSubVer(v => v + 1);
            }
        };
        run();
        const t = setInterval(run, SUB_LIVE ? 5 * 60 * 1000 : 60 * 1000);
        const onVis = () => { if (document.visibilityState === "visible")
            run(); };
        document.addEventListener("visibilitychange", onVis);
        return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
    }, [user?.companyId]);
    // ── Auto-save: koi bhi shared state badle to 300ms baad localStorage mein ──
    const [persistError, setPersistError] = useState("");
    useEffect(() => {
        let idleId = null;
        const run = () => {
            try {
                const payload = JSON.stringify({
                    v: 1,
                    // SECURITY: authentication session intentionally excluded from localStorage.
                    entries: sharedEntries,
                    workers: sharedWorkers, styles: sharedStyles, workerLineMap, deptAllocations: sharedDeptAllocations,
                    lines: sharedLines, cycleType: globalCycleType, graceDays: entryGraceDays, companySettings, selfNotes, selfAdvances,
                });
                const stateOk = payload === _lastStateJson ? true : twStore.set(TWE_STATE_KEY, payload);
                if (stateOk && payload !== _lastStateJson)
                    setLastStateJson(payload);
                const mockOk = saveMockParts();
                if (!stateOk || !mockOk) {
                    const msg = "Local storage full/unavailable — latest changes save nahi hue. Browser storage clear/upgrade karke retry karo.";
                    console.error(msg);
                    setPersistError(msg);
                }
                else {
                    setPersistError("");
                }
            }
            catch (e) {
                console.error("TWE auto-save failed", e);
                setPersistError("Latest changes save nahi ho paye. Browser storage check karo.");
            }
        };
        // PERF: bhaari JSON.stringify tick/tap ke dauran na chale — thoda ruk kar, browser khaali ho tab
        const t = setTimeout(() => { if (typeof window.requestIdleCallback === "function")
            idleId = window.requestIdleCallback(run, { timeout: 3000 });
        else
            run(); }, 800);
        return () => { clearTimeout(t); if (idleId !== null && typeof window.cancelIdleCallback === "function")
            window.cancelIdleCallback(idleId); };
    }, [sharedEntries, sharedWorkers, sharedStyles, workerLineMap,
        sharedDeptAllocations, sharedLines, globalCycleType, entryGraceDays, companySettings, selfNotes, selfAdvances]);
    // Demo data reset: production-like builds mein destructive console hook expose mat karo.
    useEffect(() => {
        if (!TWES_DEMO_MODE)
            return;
        window.twResetData = () => {
            twStore.del(TWE_STATE_KEY);
            twStore.del("twe_state_v1");
            twStore.del("twe_state_v2");
            twStore.del("twe_state_v3");
            twStore.del("twe_state_v4");
            twStore.del("twe_state_v5");
            twStore.del("twe_state_v6");
            twStore.del("twe_mock_v1");
            twStore.del(TWE_MOCK_KEY);
            twStore.del(SUB_SHIFT_KEY);
            clearLoginGuard();
            twSession.del(TWES_FRONTEND_SECURITY.sessionKey);
            window.location.reload();
        };
        return () => { try {
            delete window.twResetData;
        }
        catch (e) { } };
    }, []);
    const handleLogin = (u) => {
        const safeUser = stripSecrets(u);
        if (!safeUser?.id || !safeUser?.role || !safeUser?.companyId || !["admin", "manager", "tailor"].includes(safeUser.role))
            return;
        writeSecureSessionUser(safeUser);
        setUser(safeUser);
        setPage(safeUser.role === "tailor" ? "self-entry" : "departments");
        setPageHistory([]);
        setNavMenuOpen(false);
        setLocalBackHandler(null);
        setAutoOpenAdd(null);
        setWorkDeptName(null); // pichhle session ka khula drawer / sub-view wapas na aaye
    };
    const handleLogout = () => {
        twSession.del(TWES_FRONTEND_SECURITY.sessionKey);
        setUser(null);
        setPage("departments");
        setPageHistory([]);
        setNavMenuOpen(false);
        setLocalBackHandler(null);
        setAutoOpenAdd(null);
        setWorkDeptName(null); // Settings drawer (Sign Out wala) band karo, warna agle login par khula milta hai
    };
    // SECURITY NOTE: session localStorage mein rehta hai (30 din), isliye client-side role/companyId par bharosa nahi kiya ja sakta —
    // asli authorization server par (httpOnly cookie / JWT) hona chahiye. Ye sirf UI gating hai.
    useEffect(() => {
        if (user)
            writeSecureSessionUser(user);
        else
            twSession.del(TWES_FRONTEND_SECURITY.sessionKey);
    }, [user]);
    // SECURITY: inactivity timeout — shared/demo devices par forgotten login ko open nahi chhodta.
    // Last activity ka time session mein bhi likha jaata hai, isliye refresh / tab restore par timer reset nahi hota.
    useEffect(() => {
        if (!user)
            return;
        let lastActivity = Date.now();
        let lastWrite = 0;
        // storage kaam nahi kar raha ho (private mode) to sirf memory wali idle-check chalegi
        const canPersist = twSession.get(TWES_FRONTEND_SECURITY.sessionKey) !== null;
        const touch = () => {
            const now = Date.now();
            lastActivity = now;
            if (now - lastWrite >= TWES_FRONTEND_SECURITY.activityWriteMs) {
                lastWrite = now;
                touchSecureSession();
            }
        };
        const check = () => {
            // Dusre tab mein logout / expiry ho gayi ho to yahan bhi band karo
            const stillValid = readSecureSessionUser();
            if ((canPersist && !stillValid) || Date.now() - lastActivity >= TWES_FRONTEND_SECURITY.idleTimeoutMs)
                handleLogout();
        };
        const onVisible = () => { if (document.visibilityState === "visible")
            check(); };
        const events = ["pointerdown", "keydown", "touchstart", "scroll"];
        // capture: true — andar ke scrolling boxes ka scroll bhi activity gine
        events.forEach(ev => window.addEventListener(ev, touch, { passive: true, capture: true }));
        document.addEventListener("visibilitychange", onVisible);
        const timer = window.setInterval(check, 30000);
        // v25: dusre tab mein logout hote hi yahan bhi turant logout (30 second ruknay ki zaroorat nahi)
        const onStorage = (e) => { if (e.key === TWES_FRONTEND_SECURITY.sessionKey && !e.newValue)
            handleLogout(); };
        window.addEventListener("storage", onStorage);
        return () => {
            window.removeEventListener("storage", onStorage);
            events.forEach(ev => window.removeEventListener(ev, touch, { capture: true }));
            document.removeEventListener("visibilitychange", onVisible);
            window.clearInterval(timer);
        };
    }, [user]);
    // SECURITY: role-based page allow-list. URL/history/state se unauthorized screen force-open nahi hogi.
    const canAccessPage = useCallback((target) => {
        if (!user)
            return false;
        if (user.role === "tailor")
            return target === "self-entry";
        if (user.role === "manager")
            return target === "dept-work";
        if (target === "dept-work")
            return user.role === "admin";
        return NAV_ITEMS.some(n => n.id === target && n.roles.includes(user.role));
    }, [user]);
    useEffect(() => {
        if (user && !canAccessPage(page)) {
            setPage(user.role === "tailor" ? "self-entry" : user.role === "manager" ? "dept-work" : "departments");
            setPageHistory([]);
        }
    }, [user, page, canAccessPage]);
    const navigate = (p) => {
        if (!canAccessPage(p))
            return;
        if (p !== page)
            setPageHistory(prev => [...prev, page]);
        setPage(p);
        setSidebarOpen(false);
        setLocalBackHandler(null); // naya page — purana sub-view back handler stale ho gaya
    };
    // Bottom-nav ke main tabs (Dashboard/Approvals/Work Report/Styles) switch karne ke liye —
    // ye pageHistory mein push NAHI karta, taaki phone ka back button in tabs ke beech
    // udhar-idhar na kude. Back button sirf real drill-down screens (navigate() se) ke
    // liye kaam karega.
    const switchTab = (p) => {
        if (!canAccessPage(p))
            return;
        setPage(p);
        setSidebarOpen(false);
        setLocalBackHandler(null);
        setPageHistory([]); // naya tab = fresh root, purani tab ki drill-down history carry nahi honi chahiye
    };
    const goBack = () => {
        if (pageHistory.length > 0) {
            const prev = pageHistory[pageHistory.length - 1];
            setPageHistory(h => h.slice(0, -1));
            setPage(canAccessPage(prev) ? prev : (user?.role === "tailor" ? "self-entry" : "departments"));
        }
        else {
            setPage(user?.role === "tailor" ? "self-entry" : "departments");
        }
        setSidebarOpen(false);
    };
    // ── Phone Back Button Support ──────────────────────────────
    // Har page change pe browser history mein ek entry push karo
    useEffect(() => {
        window.history.pushState({ page }, "", window.location.pathname);
    }, [page]);
    // Koi bhi screen khule (dashboard / styles / operations / approvals / work report ...) — hamesha top se khule
    useEffect(() => {
        const toTop = () => {
            try {
                window.scrollTo(0, 0);
                document.documentElement.scrollTop = 0;
                document.body.scrollTop = 0;
                document.querySelectorAll(".main-content").forEach(el => { el.scrollTop = 0; });
            }
            catch (e) { }
        };
        toTop();
        const r = requestAnimationFrame(toTop);
        return () => cancelAnimationFrame(r);
    }, [page, user?.role]);
    // Phone ka back button dabane pe goBack() call hoga
    useEffect(() => {
        const handlePopState = () => {
            goBack();
            // Re-push so next back press bhi kaam kare
            window.history.pushState({ page }, "", window.location.pathname);
        };
        window.addEventListener("popstate", handlePopState);
        return () => window.removeEventListener("popstate", handlePopState);
    }, [pageHistory, page, canAccessPage, user?.role]);
    // ──────────────────────────────────────────────────────────
    // ══════════════════════════════════════════
    // COMPANY DATA-ISOLATION — sirf current logged-in
    // company (user.companyId) ka data neeche jaayega.
    // Ye Admin ke Provider
    // mein use hota hai, taaki ek company ka data doosri
    // company ko kabhi na dikhe.
    // ══════════════════════════════════════════
    const companyId = user?.companyId;
    // Department manager ko sirf apni department ki entries dikhti hain
    const visibleEntries = useMemo(() => {
        const base = scopedByCompany(sharedEntries, companyId);
        if (user?.role !== "manager")
            return base;
        return base.filter(e => (e.lineId && e.lineId === user.lineId) || (e.line || e.department) === user.line);
    }, [sharedEntries, companyId, user?.role, user?.lineId, user?.line]);
    const visibleWorkers = useMemo(() => scopedByCompany(sharedWorkers, companyId), [sharedWorkers, companyId]);
    // Purane saved styles jinme companyId nahi tha — unhe current company ka stamp do (ek baar)
    useEffect(() => {
        if (!companyId)
            return;
        setSharedStyles(prev => (prev || []).some(x => !x.companyId) ? prev.map(x => x.companyId ? x : { ...x, companyId }) : prev);
    }, [companyId]);
    const visibleStyles = useMemo(() => scopedByCompany(sharedStyles, companyId), [sharedStyles, companyId]);
    const visibleLines = useMemo(() => scopedByCompany(sharedLines, companyId), [sharedLines, companyId]);
    const visibleAllocs = useMemo(() => scopedByCompany(sharedDeptAllocations, companyId), [sharedDeptAllocations, companyId]);
    const visibleLineMap = useMemo(() => { const ok = new Set(visibleWorkers.map(w => w.id)); return Object.fromEntries(Object.entries(workerLineMap || {}).filter(([wid]) => ok.has(wid))); }, [workerLineMap, visibleWorkers]);
    // ============================================================
    // PHASE 5 — CLIENT-SIDE SECURITY HARDENING
    // ------------------------------------------------------------
    // IMPORTANT: TWES.jsx currently runs on localStorage/demo state.
    // These guards reduce accidental/cross-company mutations in the
    // client, but they are NOT a replacement for Firebase/Firestore
    // Security Rules. Real production authorization must be enforced
    // again on the backend.
    // ============================================================
    const securityCompanyId = user?.companyId || "";
    const isAdminUser = user?.role === "admin";
    const denyMutation = (label) => {
        console.warn(`[TWE Security] ${label}: admin permission required.`);
        return;
    };
    // Preserve records belonging to other tenants exactly as they are;
    // only the logged-in company's records may be changed by UI setters.
    const secureCompanyArraySetter = useCallback((rawSetter, label) => {
        return (nextValue) => {
            if (!isAdminUser || !securityCompanyId) {
                denyMutation(label);
                return;
            }
            rawSetter(prev => {
                const previous = Array.isArray(prev) ? prev : [];
                const proposed = typeof nextValue === "function" ? nextValue(previous) : nextValue;
                if (!Array.isArray(proposed))
                    return previous;
                const previousById = new Map(previous.map(x => [x?.id, x]));
                const sanitizedCurrent = proposed.map(item => {
                    if (!item || typeof item !== "object")
                        return item;
                    const old = item.id ? previousById.get(item.id) : null;
                    // Existing records cannot be reassigned to another company.
                    if (old?.companyId && old.companyId !== securityCompanyId)
                        return old;
                    // New/current-company records are always stamped with the
                    // authenticated session's companyId.
                    return { ...item, companyId: securityCompanyId };
                }).filter(Boolean);
                const currentIds = new Set(sanitizedCurrent.map(x => x?.id).filter(Boolean));
                // Never allow a current-company updater to accidentally remove
                // another company's records from the shared internal state.
                const untouchedOtherCompanies = previous.filter(x => x?.companyId && x.companyId !== securityCompanyId &&
                    (!x.id || !currentIds.has(x.id)));
                return [...sanitizedCurrent, ...untouchedOtherCompanies];
            });
        };
    }, [isAdminUser, securityCompanyId]);
    const secureEntriesSetter = useCallback((nextValue) => {
        if (!isAdminUser || !securityCompanyId) {
            denyMutation("Work Entries");
            return;
        }
        setSharedEntries(prev => {
            const previous = Array.isArray(prev) ? prev : [];
            const proposed = typeof nextValue === "function" ? nextValue(previous) : nextValue;
            if (!Array.isArray(proposed))
                return previous;
            const previousById = new Map(previous.map(x => [x?.id, x]));
            const sanitized = proposed.map(item => {
                if (!item || typeof item !== "object")
                    return item;
                const old = item.id ? previousById.get(item.id) : null;
                if (old?.companyId && old.companyId !== securityCompanyId)
                    return old;
                return { ...item, companyId: securityCompanyId };
            }).filter(Boolean);
            const ids = new Set(sanitized.map(x => x?.id).filter(Boolean));
            return [...sanitized, ...previous.filter(x => x?.companyId && x.companyId !== securityCompanyId && (!x.id || !ids.has(x.id)))];
        });
    }, [isAdminUser, securityCompanyId]);
    const secureWorkerLineMapSetter = useCallback((nextValue) => {
        const mgrLine = user?.role === "manager" ? (sharedLines || []).find(l => l.id === user.lineId && l.companyId === user.companyId) : null;
        const isMgrTeam = !!mgrLine?.managerCanAddMembers;
        if ((!isAdminUser && !isMgrTeam) || !securityCompanyId) {
            denyMutation("Tailor Department Membership");
            return;
        }
        setWorkerLineMap(prev => {
            const base = (prev && typeof prev === "object") ? prev : {};
            const proposed = typeof nextValue === "function" ? nextValue(base) : nextValue;
            if (!proposed || typeof proposed !== "object")
                return base;
            const allowedWorkerIds = new Set((sharedWorkers || [])
                .filter(w => w?.companyId === securityCompanyId)
                .map(w => w.id));
            // Manager sirf apni department ka membership badal sakta hai (kisi aur department ya worker ka nahi)
            if (isMgrTeam && !isAdminUser) {
                const lid = mgrLine.id;
                const out = { ...base };
                Object.keys(proposed).forEach(wid => {
                    if (!allowedWorkerIds.has(wid))
                        return;
                    const before = base[wid] || [], after = proposed[wid] || [];
                    const had = before.includes(lid), has = after.includes(lid);
                    if (had !== has)
                        out[wid] = has ? [...new Set([...before, lid])] : before.filter(x => x !== lid);
                });
                return out;
            }
            // Worker membership keys are accepted only for workers in the
            // authenticated company.
            const proposedAllowed = Object.fromEntries(Object.entries(proposed).filter(([workerId]) => allowedWorkerIds.has(workerId)));
            const untouchedOtherWorkers = Object.fromEntries(Object.entries(base).filter(([workerId]) => !allowedWorkerIds.has(workerId)));
            return { ...untouchedOtherWorkers, ...proposedAllowed };
        });
    }, [isAdminUser, securityCompanyId, sharedWorkers, user, sharedLines]);
    const securedSetSharedEntries = secureEntriesSetter;
    const securedSetSharedWorkers = secureCompanyArraySetter(setSharedWorkers, "Workers");
    const securedSetSharedStyles = secureCompanyArraySetter(setSharedStyles, "Styles");
    const securedSetSharedLines = secureCompanyArraySetter(setSharedLines, "Departments");
    const securedSetSharedDeptAllocations = secureCompanyArraySetter(setSharedDeptAllocations, "Style Allocations");
    // Invitation accept hone par naya/wapas active worker + department enrollment state mein sync (taaki persist bhi ho)
    useEffect(() => {
        const h = (e) => {
            setSharedWorkers([...MOCK_DB.workers]);
            const d = (e && e.detail) || {};
            if (d.workerId && Array.isArray(d.lineIds) && d.lineIds.length)
                setWorkerLineMap(prev => ({ ...(prev || {}), [d.workerId]: d.lineIds }));
            // Team request reject / 24h expiry: department se hatao + us dauran ki entries DELETE
            const tr = d.teamRemove;
            if (tr) {
                setWorkerLineMap(prev => ({ ...(prev || {}), [tr.workerId]: ((prev || {})[tr.workerId] || []).filter(id => id !== tr.lineId) }));
                const since = new Date(tr.since).getTime();
                const next = sharedEntriesRef.current.filter(en => !(en.workerId === tr.workerId && sameCompany(en, tr.companyId) && (en.lineId === tr.lineId || en.line === tr.lineName)
                    && new Date(en.submittedAt || 0).getTime() >= since));
                sharedEntriesRef.current = next;
                setSharedEntries(next);
            }
        };
        window.addEventListener("twes-connection-changed", h);
        return () => window.removeEventListener("twes-connection-changed", h);
    }, []);
    // 24 ghante ki expiry check — load par aur har minute
    useEffect(() => {
        sweepTeamRequests();
        const t = setInterval(sweepTeamRequests, 60000);
        return () => clearInterval(t);
    }, []);
    // Manager ka department/mobile admin ne badal diya ya hata diya ho to saved session bhi band
    useEffect(() => {
        if (user?.role !== "manager")
            return;
        const assigned = (sharedLines || []).filter(x => x.companyId === user.companyId && x.managerMobile === user.mobile);
        const l = assigned.find(x => x.id === user.lineId) || assigned[0];
        if (!l) {
            setUser(null);
            setPage("departments");
            setPageHistory([]);
        }
        else if (l.id !== user.lineId || l.name !== user.line)
            setUser(prev => prev?.role === "manager" ? { ...prev, lineId: l.id, line: l.name, assignedLineIds: assigned.map(x => x.id) } : prev);
    }, [user, sharedLines]);
    // Tailor ko admin ne remove (inactive) kar diya ho to saved session bhi band — dobara login nahi chalega
    useEffect(() => {
        if (user?.role !== "tailor")
            return;
        const w = (sharedWorkers || []).find(x => x.id === user.workerId && x.companyId === user.companyId);
        if (!w || w.status !== "active") {
            setUser(null);
            setPage("departments");
            setPageHistory([]);
        }
    }, [user, sharedWorkers]);
    if (!user)
        return React.createElement(React.Fragment, null,
            React.createElement(GlobalStyles, null),
            React.createElement(LoginPage, { onLogin: handleLogin, sharedLines: sharedLines }));
    const allowedNav = NAV_ITEMS.filter(n => n.roles.includes(user.role));
    const bottomNav = allowedNav.filter(n => BOTTOM_NAV.includes(n.id));
    const shellHeader = user?.role === "admin";
    const navOn = (id) => page === id || (id === "approvals" && page === "work-report");
    const isRootTab = (BOTTOM_NAV.includes(page) || page === "work-report") && !localBackHandler && pageHistory.length === 0;
    const renderPage = () => {
        // Tailor sirf apni Self Entry dekh sakta hai — koi admin page nahi (page state kuch bhi ho)
        if (user.role === "tailor")
            return React.createElement(TailorPanel, { onLogout: handleLogout });
        if (user.role === "manager")
            return React.createElement(ManagerPanel, { onLogout: handleLogout });
        switch (page) {
            case "dashboard": return React.createElement(Dashboard, { onLogout: handleLogout });
            case "departments": return React.createElement(Departments, { embedded: true });
            case "styles": return React.createElement(Styles, null);
            case "operations": return React.createElement(Operations, null);
            case "work-report": return React.createElement(WorkReport, null);
            case "approvals": return React.createElement(Approvals, null);
            case "connect": return React.createElement(ConnectCompanyPanel, { user: user, role: "admin" });
            case "dept-work": return React.createElement(WorkEntryPanel, { dept: workDeptName, onLogout: user.role === "manager" ? handleLogout : null });
            default: return React.createElement(Departments, { embedded: true });
        }
    };
    return (React.createElement(ToastProvider, null,
        React.createElement(GlobalStyles, null),
        React.createElement(AppContext.Provider, { value: { appCycleKey, setAppCycleKey, appCycles, user, setUser, navigate, switchTab, goBack, localBackHandler, setLocalBackHandler, setWorkDeptName, sharedEntries: visibleEntries, setSharedEntries: securedSetSharedEntries, sharedStyles: visibleStyles, setSharedStyles: securedSetSharedStyles, sharedWorkers: visibleWorkers, setSharedWorkers: securedSetSharedWorkers, sharedActions, globalCycleType, setGlobalCycleType, entryGraceDays, setEntryGraceDays, sharedLines: visibleLines, setSharedLines: securedSetSharedLines, workerLineMap: visibleLineMap, setWorkerLineMap: secureWorkerLineMapSetter, autoOpenAdd, setAutoOpenAdd, autoSelectStyleId, setAutoSelectStyleId, sharedDeptAllocations: visibleAllocs, setSharedDeptAllocations: securedSetSharedDeptAllocations, changeCycleType, selfNotes, setSelfNotes, selfAdvances, setSelfAdvances, companySettings, updateCompanyProfile } },
            React.createElement("div", { className: "min-h-screen bg-slate-50 text-gray-900 font-sans", style: { fontFamily: "'Inter','Segoe UI',system-ui,sans-serif" } },
                persistError && (React.createElement("div", { className: "fixed top-2 left-2 right-2 z-[100] bg-red-600 text-white rounded-xl px-4 py-3 text-xs font-bold" }, persistError)),
                React.createElement("div", { className: "sr-only", "aria-live": "polite" }, "TailorNetwork Frontend Security active. Session, role and company-scope checks enabled."),
                shellHeader && (React.createElement(AppHeader, { title: page === "dept-work" ? (workDeptName || "Department") : ((NAV_ITEMS.find(n => n.id === page) || {}).label || "TailorNetwork"), company: user?.tenantName, showCycle: page === "dept-work", reportSwitch: (page === "approvals" || page === "work-report") ? { page, onSwitch: switchTab } : (page === "dept-work" ? { kind: "dept" } : undefined), hideMenu: page === "dept-work" || page === "work-report" || page === "approvals", onAdd: { styles: "styles-here", operations: "operations", connect: "network-post" }[page] ? () => setAutoOpenAdd({ styles: "styles-here", operations: "operations", connect: "network-post" }[page]) : undefined, addLabel: page === "connect" ? "Post" : "Add", onMessage: page === "connect" && user?.role === "admin" ? () => setAutoOpenAdd("network-update") : undefined, connectCompanyId: page === "connect" ? user?.companyId : undefined, onMenu: () => setNavMenuOpen(true), rootTab: isRootTab, onBack: () => { if (localBackHandler) {
                        localBackHandler();
                    }
                    else {
                        goBack();
                    } }, onLogout: handleLogout })),
                shellHeader && React.createElement(Dashboard, { onLogout: handleLogout, drawerMode: true, drawerOpen: navMenuOpen, onDrawerClose: () => setNavMenuOpen(false) }),
                React.createElement("div", { className: "flex flex-col min-h-screen" },
                    React.createElement("main", { className: `main-content flex-1 ${(user.role === "tailor" || user.role === "manager") ? "tw-flush-top" : ""} ${shellHeader ? "tw-below-hdr" : ""} ${(user.role === "tailor" || user.role === "manager") ? "p-0" : page === "dept-work" ? "py-4 px-0" : "py-4 px-0"} w-full ${(bottomNav.length > 1 && isRootTab) ? "pb-24" : "pb-6"}` },
                        React.createElement("div", { key: page, className: "tw-screen-in" }, renderPage()))),
                // Bottom nav sirf pehle (root) pages par — andar ke pages (Entry, Salary detail, form wagairah) par nahi
                bottomNav.length > 1 && isRootTab && (React.createElement("nav", { "aria-label": "Main", className: "tw-nav fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-20", style: { paddingBottom: "env(safe-area-inset-bottom)", borderRadius: "24px 24px 0 0" } },
                    React.createElement("div", { className: "flex items-center justify-around px-1 py-1" }, bottomNav.map(item => (React.createElement("button", { key: item.id, type: "button", "aria-current": navOn(item.id) ? "page" : undefined, onClick: () => switchTab(item.id), className: `tw-nav-item flex flex-col items-center gap-0.5 flex-1 py-2 rounded-xl transition-all active:scale-95
                  ${navOn(item.id) ? "tw-nav-on tw-gtext" : "text-gray-900"}` },
                        React.createElement("div", { className: `relative flex items-center justify-center w-8 h-8 rounded-xl transition-all
                  ${navOn(item.id) ? "tw-nav-ico bg-green-50 scale-110" : ""}` },
                            React.createElement(NavIcon, { id: item.id, size: 20 })),
                        React.createElement("span", { className: `text-xs leading-none ${navOn(item.id) ? "font-extrabold tw-gtext" : "font-semibold text-gray-900"}` }, item.short || item.label),
                        navOn(item.id) && React.createElement("div", { className: "absolute bottom-0 w-4 h-0.5 bg-green-600 rounded-full" })))))))))));
}
// ── ERROR BOUNDARY — koi bhi render error poori app ko white screen na kare ──
class TwesErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err }; }
    componentDidCatch(err, info) { try {
        console.error("TWES render error:", err, info && info.componentStack);
    }
    catch (e) { } }
    render() {
        if (!this.state.err)
            return this.props.children;
        const btn = { width: "100%", minHeight: 48, borderRadius: 999, fontSize: 15, fontWeight: 800, cursor: "pointer" };
        return (React.createElement("div", { style: { position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "#F5F8FC", fontFamily: "system-ui, -apple-system, sans-serif" } },
            React.createElement("div", { style: { maxWidth: 360, width: "100%", textAlign: "center", background: "#FFFFFF", borderRadius: 24, padding: 24, border: "1.5px solid #D5DED9" } },
                React.createElement("div", { style: { lineHeight: 1 } },
                    React.createElement(AlertTriangle, { size: 40, color: "#B42318", "aria-hidden": "true", style: { margin: "0 auto" } })),
                React.createElement("h1", { style: { fontSize: 20, fontWeight: 800, color: "#172033", margin: "10px 0 6px" } }, "Kuch galat ho gaya"),
                React.createElement("p", { style: { fontSize: 14, color: "#172033", margin: "0 0 16px" } }, "Aapka saved data delete nahi hua. Dobara try karo, na chale to app reload karo."),
                TWES_DEMO_MODE && React.createElement("p", { style: { fontSize: 11, color: "#B42318", margin: "0 0 12px", wordBreak: "break-word" } }, String((this.state.err && this.state.err.message) || this.state.err)),
                React.createElement("button", { type: "button", onClick: () => this.setState({ err: null }), style: { ...btn, background: "#078747", color: "#FFFFFF", border: "none", marginBottom: 10 } }, "Dobara try karo"),
                React.createElement("button", { type: "button", onClick: () => window.location.reload(), style: { ...btn, background: "#FFFFFF", color: "#078747", border: "2px solid #078747" } }, "Reload app"))));
    }
}
function App() { return React.createElement(TwesErrorBoundary, null,
    React.createElement(AppInner, null)); }
export default App;
