import React, { useEffect, useMemo, useState, useCallback, memo } from "react";
import { useTable, usePagination, useSortBy, useFilters } from "react-table";
import * as XLSX from "xlsx";

/**
 * Student Marks POC UI
 * Features:
 * - Fetch students from API
 * - Inline add row (temporary negative RollNo until save)
 * - Buffered inline editing for First/Last name (commits on blur/Enter)
 * - Upload Excel marks per row
 * - Sorting, filtering, pagination (react-table v7)
 * - Modal success/error messages
 *
 * Backend Routes (proxied by Vite to :5000):
 *   GET  /students
 *   POST /students                  body: { firstName, lastName, marksFilePath? }
 *   POST /upload/:rollNumber        form-data: file
 * Static:
 *   GET  /template.xlsx             place file under /public/template.xlsx
 */

// ---------- tiny logger ----------
const log = {
  info: (...a) => console.log("[INFO]", ...a),
  warn: (...a) => console.warn("[WARN]", ...a),
  error: (...a) => console.error("[ERROR]", ...a),
};

// ---------- Modal ----------
const Modal = ({ type = "info", message, onClose }) => {
  if (!message) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className={`modal ${type}`}>
        <div className="modal-header">
          <h4 className="modal-title">{type === "error" ? "Error" : "Success"}</h4>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{message}</div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
};

// ---------- Column filter (text) ----------
function DefaultColumnFilter({ column: { filterValue, setFilter, Header } }) {
  return (
    <input
      className="input input-filter"
      value={filterValue || ""}
      onChange={(e) => setFilter(e.target.value || undefined)}
      placeholder={`Filter ${Header}`}
    />
  );
}

// ---------- Buffered editable text input ----------
// Keeps local state while typing and only commits value on blur/Enter.
// Prevents cell remount flicker / caret jumps when table re-renders.
const EditableText = memo(function EditableText({
  value: initialValue,
  placeholder,
  onCommit,
}) {
  const [value, setValue] = useState(initialValue ?? "");
  useEffect(() => setValue(initialValue ?? ""), [initialValue]);

  return (
    <input
      className="input input-cell"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur(); // commit on Enter
      }}
    />
  );
});

export default function App() {
  // ---------- state ----------
  const [students, setStudents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [modal, setModal] = useState({ type: "", message: "" });
  const [pageSize, setPageSize] = useState(10);

  // ---------- api: fetch students ----------
  const fetchStudents = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/students");
      if (!res.ok) throw new Error(`GET /students failed: ${res.status}`);
      const data = await res.json();
      const normalized = data.map((r) => ({
        rollNumber: r.RollNumber ?? r.rollNumber,
        firstName: r.FirstName ?? r.firstName ?? "",
        lastName: r.LastName ?? r.lastName ?? "",
        marksFilePath: r.MarksFilePath ?? r.marksFilePath ?? "",
        isPersisted: true,
      }));
      setStudents(normalized);
      log.info("Fetched students:", normalized.length);
    } catch (err) {
      log.error(err);
      setModal({ type: "error", message: "Failed to load students." });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchStudents(); }, [fetchStudents]);

  // ---------- actions ----------
  const handleDownloadTemplate = useCallback(() => {
    try {
      const a = document.createElement("a");
      a.href = "/template.xlsx";
      a.download = "StudentTemplate.xlsx";
      a.click();
      setModal({ type: "success", message: "Template downloaded successfully." });
    } catch (e) {
      log.error("Template download error", e);
      setModal({ type: "error", message: "Template download failed." });
    }
  }, []);

  const handleAddRow = useCallback(() => {
    const tempId = -(students.length + 1);
    setStudents((prev) => [
      ...prev,
      { rollNumber: tempId, firstName: "", lastName: "", marksFilePath: "", isPersisted: false },
    ]);
  }, [students.length]);

  // Commit a field change to table state (used by EditableText on blur/Enter)
  const updateRow = useCallback((rowIndex, field, value) => {
    setStudents((prev) => {
      const copy = [...prev];
      copy[rowIndex] = { ...copy[rowIndex], [field]: value };
      return copy;
    });
  }, []);

  // Save a row to backend -> replace temp row with persisted one (with real RollNumber)
  const saveRow = useCallback(async (rowIndex) => {
    try {
      const row = students[rowIndex];
      if (!row.firstName?.trim() || !row.lastName?.trim()) {
        setModal({ type: "error", message: "First Name and Last Name are required." });
        return;
      }

      const res = await fetch("/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          marksFilePath: row.marksFilePath || "",
        }),
      });
      if (!res.ok) throw new Error(`POST /students failed: ${res.status}`);
      const body = await res.json();
      const persisted = body.student || {};

      setStudents((prev) => {
        const copy = [...prev];
        copy[rowIndex] = {
          rollNumber: persisted.RollNumber ?? persisted.rollNumber ?? row.rollNumber,
          firstName: persisted.FirstName ?? persisted.firstName ?? row.firstName,
          lastName: persisted.LastName ?? persisted.lastName ?? row.lastName,
          marksFilePath: persisted.MarksFilePath ?? persisted.marksFilePath ?? row.marksFilePath,
          isPersisted: true,
        };
        return copy;
      });

      setModal({ type: "success", message: "Student saved successfully." });
    } catch (e) {
      log.error(e);
      setModal({ type: "error", message: "Failed to save student." });
    }
  }, [students]);

  // Upload marks file for a persisted row
  const uploadMarks = useCallback(async (rowIndex, file) => {
    try {
      const row = students[rowIndex];
      if (!row.isPersisted || !row.rollNumber || row.rollNumber < 0) {
        setModal({ type: "error", message: "Save the student first to get a Roll Number, then upload marks." });
        return;
      }
      if (!file) return;

      // Optional local validation of template sheet
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (!rows.length) {
        setModal({ type: "error", message: "Template is empty or invalid." });
        return;
      }

      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/upload/${row.rollNumber}`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`POST /upload/${row.rollNumber} failed: ${res.status}`);
      const body = await res.json();

      setStudents((prev) => {
        const copy = [...prev];
        copy[rowIndex] = { ...copy[rowIndex], marksFilePath: body.path || copy[rowIndex].marksFilePath };
        return copy;
      });

      setModal({ type: "success", message: "Marks uploaded and stored successfully." });
    } catch (e) {
      log.error(e);
      setModal({ type: "error", message: "Failed to upload marks." });
    }
  }, [students]);

  // ---------- react-table setup ----------
  const defaultColumn = useMemo(() => ({ Filter: DefaultColumnFilter }), []);

  // IMPORTANT: columns depend only on stable callbacks, not on `students`,
  // so inputs don't remount while typing (we use EditableText which buffers).
  const columns = useMemo(
    () => [
      { Header: "Roll No.", accessor: "rollNumber", disableFilters: true },
      {
        Header: "First Name",
        accessor: "firstName",
        Cell: ({ row, value }) => (
          <EditableText
            value={value}
            placeholder="First name"
            onCommit={(val) => updateRow(row.index, "firstName", val)}
          />
        ),
      },
      {
        Header: "Last Name",
        accessor: "lastName",
        Cell: ({ row, value }) => (
          <EditableText
            value={value}
            placeholder="Last name"
            onCommit={(val) => updateRow(row.index, "lastName", val)}
          />
        ),
      },
      {
        Header: "Upload Marks",
        id: "upload",
        disableFilters: true,
        Cell: ({ row }) => (
          <input
            type="file"
            className="input-file"
            onChange={(e) => uploadMarks(row.index, e.target.files?.[0])}
          />
        ),
      },
      {
        Header: "Actions",
        id: "actions",
        disableFilters: true,
        Cell: ({ row }) => (
          <div className="btn-group">
            {row.original.isPersisted ? (
              <span className="badge badge-success">Saved</span>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => saveRow(row.index)}>
                Save
              </button>
            )}
          </div>
        ),
      },
    ],
    [updateRow, uploadMarks, saveRow]
  );

  const tableInstance = useTable(
    { columns, data: students, defaultColumn, initialState: { pageSize } },
    useFilters,
    useSortBy,
    usePagination
  );

  const {
    getTableProps, getTableBodyProps, headerGroups, prepareRow, page,
    canPreviousPage, canNextPage, pageOptions, nextPage, previousPage,
    state: { pageIndex }, setPageSize: setPageSizeTable,
  } = tableInstance;

  useEffect(() => { setPageSizeTable(pageSize); }, [pageSize, setPageSizeTable]);

  // ---------- render ----------
  return (
    <div className="container">
      <header className="app-header">
        <h2>Student Marks Upload</h2>
        <div className="header-actions">
          <button className="btn" onClick={handleDownloadTemplate}>Download Template</button>
          <button className="btn btn-primary" onClick={handleAddRow}>Add Row</button>
        </div>
      </header>

      <section className="card">
        <div className="table-responsive">
          <table className="table" {...getTableProps()}>
            <thead>
              {headerGroups.map((hg) => (
                <tr {...hg.getHeaderGroupProps()}>
                  {hg.headers.map((col) => (
                    <th {...col.getHeaderProps(col.getSortByToggleProps())}>
                      <div className="th-content">
                        <span>{col.render("Header")}</span>
                        <span className={col.isSorted ? (col.isSortedDesc ? "sort desc" : "sort asc") : "sort"} />
                      </div>
                      {col.canFilter && <div className="th-filter">{col.render("Filter")}</div>}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>

            <tbody {...getTableBodyProps()}>
              {isLoading ? (
                <tr><td colSpan={columns.length}>Loading…</td></tr>
              ) : page.length ? (
                page.map((row) => {
                  prepareRow(row);
                  return (
                    <tr {...row.getRowProps()}>
                      {row.cells.map((cell) => (
                        <td {...cell.getCellProps()}>{cell.render("Cell")}</td>
                      ))}
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={columns.length}>No students yet. Click "Add Row" to begin.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <div className="pagination">
            <button className="btn" onClick={previousPage} disabled={!canPreviousPage}>&laquo; Prev</button>
            <span className="page-indicator">Page {pageIndex + 1} of {pageOptions.length || 1}</span>
            <button className="btn" onClick={nextPage} disabled={!canNextPage}>Next &raquo;</button>
          </div>

          <div className="page-size">
            <label htmlFor="pageSize">Rows per page:</label>
            <select
              id="pageSize"
              className="select"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
            >
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </section>

      <footer className="app-footer" style={{ marginTop: 10 }}>
        <small>MS Access-backed POC • Sorting • Filtering • Pagination • Inline editing</small>
      </footer>

      <Modal
        type={modal.type === "error" ? "error" : modal.type ? "success" : "info"}
        message={modal.message}
        onClose={() => setModal({ type: "", message: "" })}
      />
    </div>
  );
}
