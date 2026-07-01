import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";

const APP_DOC_PATH = ["apps", "waterloo-account"];

const uid = () => Math.random().toString(36).slice(2, 10);

const emptyData = {
  categories: [],
};

function DialogBox({ dialogRef, title, children, actions }) {
  return (
    <dialog ref={dialogRef} className="app-dialog">
      <div className="dialog-header">
        <h3>{title}</h3>
        <button
          className="icon-btn"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          ×
        </button>
      </div>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}

function createFormulaPart(fieldName = "", operator = "+") {
  return { id: uid(), fieldName, operator };
}

export default function App() {
  const [data, setData] = useState(emptyData);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [sheetForm, setSheetForm] = useState({ name: "" });
  const [tableForm, setTableForm] = useState({ name: "" });
  const [fieldForm, setFieldForm] = useState({
    name: "",
    type: "text",
    linkCategoryId: "",
    linkFieldName: "",
    formulaParts: [createFormulaPart("", "+"), createFormulaPart("", "")],
  });
  const [rowForm, setRowForm] = useState({});

  const [confirmState, setConfirmState] = useState({
    title: "",
    message: "",
    action: null,
  });

  const sheetDialogRef = useRef(null);
  const tableDialogRef = useRef(null);
  const fieldDialogRef = useRef(null);
  const rowDialogRef = useRef(null);
  const confirmDialogRef = useRef(null);

  const appDocRef = doc(db, ...APP_DOC_PATH);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      appDocRef,
      async (snapshot) => {
        if (snapshot.exists()) {
          const remoteData = snapshot.data();
          setData({
            categories: remoteData.categories || [],
          });
        } else {
          await setDoc(appDocRef, {
            categories: [],
            updatedAt: serverTimestamp(),
          });
          setData(emptyData);
        }
        setLoading(false);
      },
      (error) => {
        console.error("Firestore listener error:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const categories = data.categories;

  const selectedCategory = useMemo(() => {
    return categories.find((cat) => cat.id === selectedCategoryId) || null;
  }, [categories, selectedCategoryId]);

  const selectedTable = selectedCategory?.table || null;

  const availableLinkFields = useMemo(() => {
    const linkedCategory = categories.find(
      (cat) => cat.id === fieldForm.linkCategoryId
    );
    return linkedCategory?.table?.fields || [];
  }, [categories, fieldForm.linkCategoryId]);

  const availableFormulaFields = useMemo(() => {
    return (
      selectedTable?.fields.filter(
        (field) => field.type === "number" || field.type === "formula"
      ) || []
    );
  }, [selectedTable]);

  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
    }

    if (
      selectedCategoryId &&
      !categories.some((category) => category.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(categories[0]?.id || null);
    }
  }, [categories, selectedCategoryId]);

  async function saveData(nextData) {
    setSaving(true);
    try {
      await setDoc(appDocRef, {
        categories: nextData.categories,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Save failed:", error);
      alert("Could not save data to Firebase.");
    } finally {
      setSaving(false);
    }
  }

  function openDialog(ref) {
    ref.current?.showModal();
  }

  function closeDialog(ref) {
    ref.current?.close();
  }

  function openConfirmDialog(title, message, action) {
    setConfirmState({ title, message, action });
    openDialog(confirmDialogRef);
  }

  function runConfirmAction() {
    if (confirmState.action) {
      confirmState.action();
    }
    closeDialog(confirmDialogRef);
  }

  function resetFieldForm() {
    setFieldForm({
      name: "",
      type: "text",
      linkCategoryId: "",
      linkFieldName: "",
      formulaParts: [createFormulaPart("", "+"), createFormulaPart("", "")],
    });
  }

  function addFormulaPart() {
    setFieldForm((prev) => ({
      ...prev,
      formulaParts: [...prev.formulaParts, createFormulaPart("", "")],
    }));
  }

  function removeFormulaPart(partId) {
    setFieldForm((prev) => {
      if (prev.formulaParts.length <= 2) return prev;
      return {
        ...prev,
        formulaParts: prev.formulaParts.filter((part) => part.id !== partId),
      };
    });
  }

  function updateFormulaPart(partId, key, value) {
    setFieldForm((prev) => ({
      ...prev,
      formulaParts: prev.formulaParts.map((part) =>
        part.id === partId ? { ...part, [key]: value } : part
      ),
    }));
  }

  function buildFormulaText(parts) {
    return parts
      .map((part, index) => {
        if (index === parts.length - 1) return part.fieldName || "";
        return `${part.fieldName || ""} ${part.operator || ""}`.trim();
      })
      .join(" ")
      .trim();
  }

  const formulaPreview =
    fieldForm.type === "formula" && fieldForm.name
      ? `${buildFormulaText(fieldForm.formulaParts)} = ${fieldForm.name}`
      : "";

  async function addSheet() {
    const name = sheetForm.name.trim();
    if (!name) return;

    const newSheet = {
      id: uid(),
      name,
      table: null,
    };

    const nextData = {
      ...data,
      categories: [...data.categories, newSheet],
    };

    await saveData(nextData);
    setSelectedCategoryId(newSheet.id);
    setSheetForm({ name: "" });
    closeDialog(sheetDialogRef);
  }

  async function addTable() {
    if (!selectedCategory) return;

    const name = tableForm.name.trim();
    if (!name) return;

    const newTable = {
      id: uid(),
      name,
      fields: [{ id: uid(), name: "Name", type: "text" }],
      rows: [],
    };

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              table: newTable,
            }
          : cat
      ),
    };

    await saveData(nextData);
    setTableForm({ name: "" });
    closeDialog(tableDialogRef);
  }

  async function copyTable() {
    if (!selectedCategory || !selectedTable) return;

    const copiedTable = {
      ...selectedTable,
      id: uid(),
      name: `${selectedTable.name} Copy`,
      fields: selectedTable.fields.map((field) => ({
        ...field,
        id: uid(),
        formulaParts: field.formulaParts
          ? field.formulaParts.map((part) => ({ ...part, id: uid() }))
          : undefined,
      })),
      rows: [],
    };

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              table: copiedTable,
            }
          : cat
      ),
    };

    await saveData(nextData);
  }

  async function addField() {
    if (!selectedCategory || !selectedTable) return;

    const name = fieldForm.name.trim();
    if (!name) return;

    const newField = {
      id: uid(),
      name,
      type: fieldForm.type,
    };

    if (fieldForm.type === "formula") {
      const validParts = fieldForm.formulaParts.filter((part) => part.fieldName);
      if (validParts.length < 2) return;

      newField.formulaParts = validParts.map((part, index) => ({
        id: uid(),
        fieldName: part.fieldName,
        operator: index === validParts.length - 1 ? "" : part.operator || "+",
      }));

      newField.formula = buildFormulaText(newField.formulaParts);
    }

    if (fieldForm.type === "link") {
      if (!fieldForm.linkCategoryId || !fieldForm.linkFieldName) return;
      newField.linkCategoryId = fieldForm.linkCategoryId;
      newField.linkFieldName = fieldForm.linkFieldName;
    }

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              table: {
                ...cat.table,
                fields: [...cat.table.fields, newField],
                rows: cat.table.rows.map((row) => ({
                  ...row,
                  values: { ...row.values, [name]: "" },
                })),
              },
            }
          : cat
      ),
    };

    await saveData(nextData);
    resetFieldForm();
    closeDialog(fieldDialogRef);
  }

  function openAddRowDialog() {
    if (!selectedTable) return;

    const nextForm = {};
    selectedTable.fields.forEach((field) => {
      if (field.type !== "formula") {
        nextForm[field.name] = "";
      }
    });

    setRowForm(nextForm);
    openDialog(rowDialogRef);
  }

  async function addRow() {
    if (!selectedCategory || !selectedTable) return;

    const newRow = {
      id: uid(),
      values: rowForm,
    };

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              table: {
                ...cat.table,
                rows: [...cat.table.rows, newRow],
              },
            }
          : cat
      ),
    };

    await saveData(nextData);
    setRowForm({});
    closeDialog(rowDialogRef);
  }

  async function updateCell(rowId, fieldName, value) {
    if (!selectedCategory || !selectedTable) return;

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              table: {
                ...cat.table,
                rows: cat.table.rows.map((row) =>
                  row.id === rowId
                    ? {
                        ...row,
                        values: {
                          ...row.values,
                          [fieldName]: value,
                        },
                      }
                    : row
                ),
              },
            }
          : cat
      ),
    };

    await saveData(nextData);
  }

  function getCategoryById(categoryId) {
    return categories.find((cat) => cat.id === categoryId);
  }

  function evaluateFormulaField(row, field, visited = new Set()) {
    if (!field) return 0;
    if (visited.has(field.name)) return 0;
    visited.add(field.name);

    if (field.type === "number") {
      return Number(row.values[field.name] || 0);
    }

    if (field.type === "formula" && field.formulaParts?.length) {
      let total = 0;

      field.formulaParts.forEach((part, index) => {
        const dependentField = selectedTable?.fields.find(
          (f) => f.name === part.fieldName
        );

        let partValue = 0;

        if (dependentField) {
          if (dependentField.type === "formula") {
            partValue = evaluateFormulaField(row, dependentField, new Set(visited));
          } else {
            partValue = Number(row.values[dependentField.name] || 0);
          }
        }

        if (index === 0) {
          total = partValue;
        } else {
          const previousOperator = field.formulaParts[index - 1]?.operator || "+";
          if (previousOperator === "+") total += partValue;
          if (previousOperator === "-") total -= partValue;
          if (previousOperator === "*") total *= partValue;
          if (previousOperator === "/") total = partValue === 0 ? 0 : total / partValue;
        }
      });

      return Number.isFinite(total) ? total : 0;
    }

    return 0;
  }

  function getFormulaValue(row, field) {
    if (field.formulaParts?.length) {
      return evaluateFormulaField(row, field);
    }
    return "";
  }

  function getLinkedDisplayValue(row, field) {
    const linkValue = row.values[field.name];
    if (!linkValue) return "";

    const [categoryId, rowId] = String(linkValue).split(":");
    const linkedCategory = getCategoryById(categoryId);
    if (!linkedCategory?.table) return "";

    const linkedRow = linkedCategory.table.rows.find((r) => r.id === rowId);
    if (!linkedRow) return "";

    return linkedRow.values[field.linkFieldName] || "";
  }

  function getLinkOptions(field) {
    const linkedCategory = getCategoryById(field.linkCategoryId);
    if (!linkedCategory?.table) return [];

    const labelField =
      field.linkFieldName ||
      linkedCategory.table.fields[0]?.name ||
      "Name";

    return linkedCategory.table.rows.map((row) => ({
      value: `${linkedCategory.id}:${row.id}`,
      label: row.values[labelField] || "(blank)",
    }));
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "waterloo-account-data.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        const nextData = {
          categories: imported.categories || [],
        };
        await saveData(nextData);
        setSelectedCategoryId(nextData.categories?.[0]?.id || null);
      } catch {
        openConfirmDialog(
          "Import Error",
          "The selected file is not valid JSON.",
          null
        );
      }
    };
    reader.readAsText(file);
  }

  function requestDeleteSheet(sheetId) {
    openConfirmDialog(
      "Delete Sheet",
      "Are you sure you want to delete this sheet?",
      async () => {
        const remaining = categories.filter((cat) => cat.id !== sheetId);

        const nextData = {
          ...data,
          categories: data.categories.filter((cat) => cat.id !== sheetId),
        };

        await saveData(nextData);
        setSelectedCategoryId(remaining[0]?.id || null);
      }
    );
  }

  function requestDeleteField(fieldName) {
    openConfirmDialog(
      "Delete Field",
      `Delete field "${fieldName}"?`,
      async () => {
        const nextData = {
          ...data,
          categories: data.categories.map((cat) =>
            cat.id === selectedCategory.id
              ? {
                  ...cat,
                  table: {
                    ...cat.table,
                    fields: cat.table.fields.filter((field) => field.name !== fieldName),
                    rows: cat.table.rows.map((row) => {
                      const nextValues = { ...row.values };
                      delete nextValues[fieldName];
                      return { ...row, values: nextValues };
                    }),
                  },
                }
              : cat
          ),
        };

        await saveData(nextData);
      }
    );
  }

  function requestDeleteRow(rowId) {
    openConfirmDialog("Delete Row", "Delete this row?", async () => {
      const nextData = {
        ...data,
        categories: data.categories.map((cat) =>
          cat.id === selectedCategory.id
            ? {
                ...cat,
                table: {
                  ...cat.table,
                  rows: cat.table.rows.filter((row) => row.id !== rowId),
                },
              }
            : cat
        ),
      };

      await saveData(nextData);
    });
  }

  function requestReset() {
    openConfirmDialog(
      "Reset Data",
      "This will clear everything for everyone viewing this app.",
      async () => {
        await saveData(emptyData);
        setSelectedCategoryId(null);
      }
    );
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ margin: 24 }}>
        <h2>Loading shared workspace...</h2>
        <p>Please wait while Firebase connects.</p>
      </div>
    );
  }

  return (
    <>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">W</div>
            <div>
              <h1>Waterloo Account</h1>
              <p>{saving ? "Saving..." : "Realtime shared workspace"}</p>
            </div>
          </div>

          <div className="sidebar-actions">
            <button onClick={() => openDialog(sheetDialogRef)}>+ New Sheet</button>
            <button className="danger" onClick={requestReset}>
              Reset
            </button>
          </div>

          <div className="sheet-list">
            {categories.map((category) => (
              <div
                key={category.id}
                className={`sheet-item ${
                  selectedCategoryId === category.id ? "active-sheet" : ""
                }`}
              >
                <button
                  className="sheet-btn"
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
                </button>
                <button
                  className="delete-mini"
                  type="button"
                  onClick={() => requestDeleteSheet(category.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </aside>

        <main className="main-content">
          {!selectedCategory ? (
            <section className="empty-state">
              <h2>No sheet selected</h2>
              <p>Create a new sheet to start with a shared blank slate.</p>
            </section>
          ) : (
            <>
              <header className="topbar">
                <div>
                  <p className="eyebrow">Sheet</p>
                  <h2>{selectedCategory.name}</h2>
                </div>

                <div className="topbar-actions">
                  <button onClick={exportJson}>Export JSON</button>
                  <label className="import-btn">
                    Import JSON
                    <input type="file" accept=".json" onChange={importJson} hidden />
                  </label>
                </div>
              </header>

              {!selectedTable ? (
                <section className="empty-state">
                  <h3>No table yet</h3>
                  <p>Create a table under this sheet first.</p>
                  <div className="empty-actions">
                    <button onClick={() => openDialog(tableDialogRef)}>
                      Add Table
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  <section className="table-header-card">
                    <div>
                      <p className="eyebrow">Table</p>
                      <h3>{selectedTable.name}</h3>
                    </div>

                    <div className="topbar-actions">
                      <button onClick={copyTable}>Copy Table</button>
                      <button onClick={() => openDialog(fieldDialogRef)}>
                        Add Field
                      </button>
                      <button onClick={openAddRowDialog}>Add Row</button>
                    </div>
                  </section>

                  <section className="info-grid">
                    <div className="info-card">
                      <span>Table name</span>
                      <strong>{selectedTable.name}</strong>
                    </div>
                    <div className="info-card">
                      <span>Fields</span>
                      <strong>{selectedTable.fields.length}</strong>
                    </div>
                    <div className="info-card">
                      <span>Rows</span>
                      <strong>{selectedTable.rows.length}</strong>
                    </div>
                  </section>

                  <section className="field-strip">
                    {selectedTable.fields.map((field) => (
                      <div key={field.id} className="field-pill">
                        <span>
                          {field.name} ({field.type})
                        </span>
                        <button
                          type="button"
                          onClick={() => requestDeleteField(field.name)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </section>

                  <section className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {selectedTable.fields.map((field) => (
                            <th key={field.id}>{field.name}</th>
                          ))}
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedTable.rows.length === 0 ? (
                          <tr>
                            <td colSpan={selectedTable.fields.length + 1}>
                              <div className="empty-inline">
                                No rows yet. Click Add Row.
                              </div>
                            </td>
                          </tr>
                        ) : (
                          selectedTable.rows.map((row) => (
                            <tr key={row.id}>
                              {selectedTable.fields.map((field) => (
                                <td key={field.id}>
                                  {field.type === "formula" ? (
                                    <div className="formula-cell">
                                      {getFormulaValue(row, field)}
                                    </div>
                                  ) : field.type === "link" ? (
                                    <div className="link-cell">
                                      <select
                                        value={row.values[field.name] || ""}
                                        onChange={(e) =>
                                          updateCell(row.id, field.name, e.target.value)
                                        }
                                      >
                                        <option value="">Select linked row</option>
                                        {getLinkOptions(field).map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                      <small>
                                        Showing: {getLinkedDisplayValue(row, field) || "-"}
                                      </small>
                                    </div>
                                  ) : field.type === "number" ? (
                                    <input
                                      type="number"
                                      value={row.values[field.name] ?? ""}
                                      onChange={(e) =>
                                        updateCell(row.id, field.name, e.target.value)
                                      }
                                    />
                                  ) : (
                                    <input
                                      type="text"
                                      value={row.values[field.name] || ""}
                                      onChange={(e) =>
                                        updateCell(row.id, field.name, e.target.value)
                                      }
                                    />
                                  )}
                                </td>
                              ))}
                              <td>
                                <button
                                  className="danger-text"
                                  type="button"
                                  onClick={() => requestDeleteRow(row.id)}
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </div>

      <DialogBox
        dialogRef={sheetDialogRef}
        title="Create Sheet"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(sheetDialogRef)}
            >
              Cancel
            </button>
            <button type="button" onClick={addSheet}>
              Save Sheet
            </button>
          </>
        }
      >
        <label className="field-block">
          <span>Sheet name</span>
          <input
            type="text"
            value={sheetForm.name}
            onChange={(e) => setSheetForm({ name: e.target.value })}
            placeholder="e.g. Orders"
          />
        </label>
      </DialogBox>

      <DialogBox
        dialogRef={tableDialogRef}
        title="Create Table"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(tableDialogRef)}
            >
              Cancel
            </button>
            <button type="button" onClick={addTable}>
              Save Table
            </button>
          </>
        }
      >
        <label className="field-block">
          <span>Table name</span>
          <input
            type="text"
            value={tableForm.name}
            onChange={(e) => setTableForm({ name: e.target.value })}
            placeholder="e.g. Order List"
          />
        </label>
      </DialogBox>

      <DialogBox
        dialogRef={fieldDialogRef}
        title="Add Field"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => {
                resetFieldForm();
                closeDialog(fieldDialogRef);
              }}
            >
              Cancel
            </button>
            <button type="button" onClick={addField}>
              Save Field
            </button>
          </>
        }
      >
        <div className="dialog-grid">
          <label className="field-block">
            <span>Field name</span>
            <input
              type="text"
              value={fieldForm.name}
              onChange={(e) =>
                setFieldForm((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="e.g. Result"
            />
          </label>

          <label className="field-block">
            <span>Field type</span>
            <select
              value={fieldForm.type}
              onChange={(e) =>
                setFieldForm((prev) => ({
                  ...prev,
                  type: e.target.value,
                  linkCategoryId: "",
                  linkFieldName: "",
                  formulaParts: [createFormulaPart("", "+"), createFormulaPart("", "")],
                }))
              }
            >
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="link">Link</option>
              <option value="formula">Formula</option>
            </select>
          </label>

          {fieldForm.type === "formula" && (
            <div className="formula-builder">
              {fieldForm.formulaParts.map((part, index) => (
                <div key={part.id} className="formula-row">
                  <label className="field-block">
                    <span>Field {index + 1}</span>
                    <select
                      value={part.fieldName}
                      onChange={(e) =>
                        updateFormulaPart(part.id, "fieldName", e.target.value)
                      }
                    >
                      <option value="">Select field</option>
                      {availableFormulaFields.map((field) => (
                        <option key={field.id} value={field.name}>
                          {field.name} ({field.type})
                        </option>
                      ))}
                    </select>
                  </label>

                  {index < fieldForm.formulaParts.length - 1 && (
                    <label className="field-block formula-operator">
                      <span>Operator</span>
                      <select
                        value={part.operator}
                        onChange={(e) =>
                          updateFormulaPart(part.id, "operator", e.target.value)
                        }
                      >
                        <option value="+">+</option>
                        <option value="-">-</option>
                        <option value="*">*</option>
                        <option value="/">/</option>
                      </select>
                    </label>
                  )}

                  <button
                    type="button"
                    className="remove-part-btn"
                    onClick={() => removeFormulaPart(part.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}

              <div className="formula-actions">
                <button type="button" onClick={addFormulaPart}>
                  + Add Another Field
                </button>
              </div>

              {formulaPreview && (
                <div className="formula-preview">
                  Preview: {formulaPreview}
                </div>
              )}
            </div>
          )}

          {fieldForm.type === "link" && (
            <>
              <label className="field-block">
                <span>Link to sheet</span>
                <select
                  value={fieldForm.linkCategoryId}
                  onChange={(e) =>
                    setFieldForm((prev) => ({
                      ...prev,
                      linkCategoryId: e.target.value,
                      linkFieldName: "",
                    }))
                  }
                >
                  <option value="">Select sheet</option>
                  {categories
                    .filter((cat) => cat.id !== selectedCategoryId && cat.table)
                    .map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                </select>
              </label>

              <label className="field-block">
                <span>Display field</span>
                <select
                  value={fieldForm.linkFieldName}
                  onChange={(e) =>
                    setFieldForm((prev) => ({
                      ...prev,
                      linkFieldName: e.target.value,
                    }))
                  }
                >
                  <option value="">Select field</option>
                  {availableLinkFields.map((field) => (
                    <option key={field.id} value={field.name}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </DialogBox>

      <DialogBox
        dialogRef={rowDialogRef}
        title="Add Row"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(rowDialogRef)}
            >
              Cancel
            </button>
            <button type="button" onClick={addRow}>
              Save Row
            </button>
          </>
        }
      >
        <div className="dialog-grid">
          {selectedTable?.fields
            .filter((field) => field.type !== "formula")
            .map((field) => (
              <label key={field.id} className="field-block">
                <span>{field.name}</span>

                {field.type === "link" ? (
                  <select
                    value={rowForm[field.name] || ""}
                    onChange={(e) =>
                      setRowForm((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select linked row</option>
                    {getLinkOptions(field).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === "number" ? (
                  <input
                    type="number"
                    value={rowForm[field.name] ?? ""}
                    onChange={(e) =>
                      setRowForm((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                  />
                ) : (
                  <input
                    type="text"
                    value={rowForm[field.name] || ""}
                    onChange={(e) =>
                      setRowForm((prev) => ({
                        ...prev,
                        [field.name]: e.target.value,
                      }))
                    }
                  />
                )}
              </label>
            ))}
        </div>
      </DialogBox>

      <DialogBox
        dialogRef={confirmDialogRef}
        title={confirmState.title || "Confirm"}
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(confirmDialogRef)}
            >
              {confirmState.action ? "Cancel" : "Close"}
            </button>
            {confirmState.action && (
              <button type="button" onClick={runConfirmAction}>
                Confirm
              </button>
            )}
          </>
        }
      >
        <p className="confirm-text">{confirmState.message}</p>
      </DialogBox>
    </>
  );
}