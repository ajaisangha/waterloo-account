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

function createFormulaPart(
  categoryId = "",
  tableId = "",
  fieldName = "",
  operator = "+"
) {
  return { id: uid(), categoryId, tableId, fieldName, operator };
}

function deepCopyTable(table, options = {}) {
  const { renameTable = true, tableIdMap = {}, targetCategoryId = null } = options;

  return {
    id: tableIdMap[table.id] || uid(),
    name: renameTable ? `${table.name} Copy` : table.name,
    fields: (table.fields || []).map((field) => {
      const copiedField = {
        id: uid(),
        name: field.name,
        type: field.type,
      };

      if (field.type === "formula") {
        copiedField.formulaParts = (field.formulaParts || []).map((part) => ({
          id: uid(),
          categoryId: targetCategoryId || part.categoryId || "",
          tableId: tableIdMap[part.tableId] || part.tableId || "",
          fieldName: part.fieldName || "",
          operator: part.operator || "",
        }));
        copiedField.formula = field.formula || "";
        copiedField.roundResult = Boolean(field.roundResult);
      }

      if (field.type === "link") {
        copiedField.linkCategoryId = field.linkCategoryId || "";
        copiedField.linkFieldName = field.linkFieldName || "";
      }

      return copiedField;
    }),
    rows: (table.rows || []).map((row) => ({
      id: uid(),
      values: { ...(row.values || {}) },
    })),
  };
}

function deepCopySheet(sheet) {
  const newSheetId = uid();
  const sourceTables = sheet.tables || [];

  const tableIdMap = sourceTables.reduce((acc, table) => {
    acc[table.id] = uid();
    return acc;
  }, {});

  return {
    id: newSheetId,
    name: `${sheet.name} Copy`,
    tables: sourceTables.map((table) =>
      deepCopyTable(table, {
        renameTable: false,
        tableIdMap,
        targetCategoryId: newSheetId,
      })
    ),
    quickSummary: {
      tableId: tableIdMap[sheet.quickSummary?.tableId] || "",
      fieldName: sheet.quickSummary?.fieldName || "",
    },
  };
}

function moveItem(list, fromIndex, toIndex) {
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return list;
  const copy = [...list];
  const [item] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, item);
  return copy;
}

export default function App() {
  const [data, setData] = useState(emptyData);
  const [selectedCategoryId, setSelectedCategoryId] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const [expandedTableIds, setExpandedTableIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [sheetForm, setSheetForm] = useState({ name: "" });
  const [tableForm, setTableForm] = useState({ name: "" });
  const [renameTableForm, setRenameTableForm] = useState({ name: "" });
  const [renameSheetForm, setRenameSheetForm] = useState({ name: "" });
  const [copyExternalTableForm, setCopyExternalTableForm] = useState({
    sourceSheetId: "",
    sourceTableId: "",
  });

  const [fieldForm, setFieldForm] = useState({
    name: "",
    type: "text",
    linkCategoryId: "",
    linkFieldName: "",
    roundResult: false,
    formulaParts: [
      createFormulaPart("", "", "", "+"),
      createFormulaPart("", "", "", ""),
    ],
  });

  const [editingFieldId, setEditingFieldId] = useState(null);
  const [editingTableId, setEditingTableId] = useState(null);
  const [editingSheetId, setEditingSheetId] = useState(null);
  const [rowForm, setRowForm] = useState({});
  const [tableQuickField, setTableQuickField] = useState("");

  const [dragSheetId, setDragSheetId] = useState(null);
  const [dragTableId, setDragTableId] = useState(null);

  const [confirmState, setConfirmState] = useState({
    title: "",
    message: "",
    action: null,
  });

  const sheetDialogRef = useRef(null);
  const tableDialogRef = useRef(null);
  const renameTableDialogRef = useRef(null);
  const renameSheetDialogRef = useRef(null);
  const fieldDialogRef = useRef(null);
  const rowDialogRef = useRef(null);
  const confirmDialogRef = useRef(null);
  const copyExternalTableDialogRef = useRef(null);

  const appDocRef = doc(db, ...APP_DOC_PATH);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      appDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const remoteData = snapshot.data();

          const normalizedCategories = (remoteData.categories || []).map((category) => {
            const tables = Array.isArray(category.tables)
              ? category.tables
              : category.table
              ? [category.table]
              : [];

            return {
              id: category.id,
              name: category.name,
              tables,
              quickSummary: {
                tableId: category.quickSummary?.tableId || "",
                fieldName: category.quickSummary?.fieldName || "",
              },
            };
          });

          setData({
            categories: normalizedCategories,
          });
        } else {
          setData({ categories: [] });
        }

        setLoading(false);
      },
      (error) => {
        console.error("Snapshot listener error:", error);
        alert(`Listener failed: ${error.message}`);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  const categories = data.categories;

  const selectedCategory = useMemo(() => {
    return categories.find((cat) => cat.id === selectedCategoryId) || null;
  }, [categories, selectedCategoryId]);

  const selectedTable = useMemo(() => {
    return selectedCategory?.tables?.find((table) => table.id === selectedTableId) || null;
  }, [selectedCategory, selectedTableId]);

  const allTables = useMemo(() => {
    return categories.flatMap((category) =>
      (category.tables || []).map((table) => ({
        ...table,
        categoryId: category.id,
        categoryName: category.name,
      }))
    );
  }, [categories]);

  const availableLinkFields = useMemo(() => {
    const linkedCategory = categories.find(
      (cat) => cat.id === fieldForm.linkCategoryId
    );
    const linkedTable = linkedCategory?.tables?.[0];
    return linkedTable?.fields || [];
  }, [categories, fieldForm.linkCategoryId]);

  const selectedSheetQuickConfig = useMemo(() => {
    return {
      tableId: selectedCategory?.quickSummary?.tableId || "",
      fieldName: selectedCategory?.quickSummary?.fieldName || "",
    };
  }, [selectedCategory]);

  const sheetQuickTableOptions = useMemo(() => {
    return selectedCategory?.tables || [];
  }, [selectedCategory]);

  const sheetQuickFieldOptions = useMemo(() => {
    if (!selectedSheetQuickConfig.tableId) return [];
    const table = (selectedCategory?.tables || []).find(
      (item) => item.id === selectedSheetQuickConfig.tableId
    );
    return (table?.fields || []).map((field) => field.name);
  }, [selectedCategory, selectedSheetQuickConfig]);

  const allCurrentSheetFieldNames = useMemo(() => {
    const names = new Set();
    (selectedCategory?.tables || []).forEach((table) => {
      (table.fields || []).forEach((field) => {
        names.add(field.name);
      });
    });
    return Array.from(names);
  }, [selectedCategory]);

  const externalSheetOptions = useMemo(() => {
    return categories.filter((cat) => cat.id !== selectedCategoryId && cat.tables?.length);
  }, [categories, selectedCategoryId]);

  const externalTableOptions = useMemo(() => {
    const sourceSheet = categories.find(
      (cat) => cat.id === copyExternalTableForm.sourceSheetId
    );
    return sourceSheet?.tables || [];
  }, [categories, copyExternalTableForm.sourceSheetId]);

  function getFormulaFieldsForTable(tableId, excludeEditingField = true) {
    const table = allTables.find((item) => item.id === tableId);
    if (!table) return [];

    return (table.fields || []).filter((field) => {
      if (field.type !== "number" && field.type !== "formula") return false;
      if (
        excludeEditingField &&
        tableId === selectedTableId &&
        field.id === editingFieldId
      ) {
        return false;
      }
      return true;
    });
  }

  function getFormulaTablesForCategory(categoryId) {
    const category = categories.find((item) => item.id === categoryId);
    return (category?.tables || []).map((table) => ({
      id: table.id,
      name: table.name,
    }));
  }

  function getCategoryName(categoryId) {
    return categories.find((cat) => cat.id === categoryId)?.name || "Sheet";
  }

  const selectedSheetQuickSummary = useMemo(() => {
    if (
      !selectedCategory ||
      !selectedSheetQuickConfig.tableId ||
      !selectedSheetQuickConfig.fieldName
    ) {
      return null;
    }

    const table = (selectedCategory.tables || []).find(
      (item) => item.id === selectedSheetQuickConfig.tableId
    );

    if (!table) return null;

    const firstRow = table.rows?.[0];
    const field = (table.fields || []).find(
      (item) => item.name === selectedSheetQuickConfig.fieldName
    );

    if (!field) return null;

    if (!firstRow) {
      return {
        tableName: table.name,
        field: selectedSheetQuickConfig.fieldName,
        value: "",
      };
    }

    const value =
      field.type === "formula"
        ? getFormulaValue(firstRow, field, table)
        : firstRow.values?.[field.name] || "";

    return {
      tableName: table.name,
      field: selectedSheetQuickConfig.fieldName,
      value,
    };
  }, [selectedCategory, selectedSheetQuickConfig, allTables]);

  function getSheetSummaryForCategory(category) {
    const quickTableId = category?.quickSummary?.tableId || "";
    const quickFieldName = category?.quickSummary?.fieldName || "";

    if (!quickTableId || !quickFieldName) return "";

    const table = (category.tables || []).find((item) => item.id === quickTableId);
    if (!table) return "";

    const field = (table.fields || []).find((item) => item.name === quickFieldName);
    if (!field) return "";

    const firstRow = table.rows?.[0];
    if (!firstRow) return "";

    if (field.type === "formula") {
      return getFormulaValue(firstRow, field, table);
    }

    return firstRow.values?.[field.name] || "";
  }

  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
    }

    if (
      selectedCategoryId &&
      !categories.some((category) => category.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(categories[0]?.id || null);
      setSelectedTableId(categories[0]?.tables?.[0]?.id || null);
    }
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (!selectedCategory) {
      setSelectedTableId(null);
      return;
    }

    const hasSelectedTable = selectedCategory.tables?.some(
      (table) => table.id === selectedTableId
    );

    if (!hasSelectedTable) {
      setSelectedTableId(selectedCategory.tables?.[0]?.id || null);
    }
  }, [selectedCategory, selectedTableId]);

  useEffect(() => {
    if (tableQuickField && !allCurrentSheetFieldNames.includes(tableQuickField)) {
      setTableQuickField("");
    }
  }, [tableQuickField, allCurrentSheetFieldNames]);

  useEffect(() => {
    if (!selectedCategory) return;

    const currentTableId = selectedCategory.quickSummary?.tableId || "";
    const currentFieldName = selectedCategory.quickSummary?.fieldName || "";

    const tableStillExists = sheetQuickTableOptions.some(
      (table) => table.id === currentTableId
    );

    if (currentTableId && !tableStillExists) {
      saveSheetQuickTable("");
      return;
    }

    if (currentFieldName && !sheetQuickFieldOptions.includes(currentFieldName)) {
      saveSheetQuickField("");
    }
  }, [selectedCategory, sheetQuickTableOptions, sheetQuickFieldOptions]);

  function sanitizeField(field) {
    const cleanField = {
      id: field.id,
      name: field.name,
      type: field.type,
    };

    if (field.type === "link") {
      cleanField.linkCategoryId = field.linkCategoryId || "";
      cleanField.linkFieldName = field.linkFieldName || "";
    }

    if (field.type === "formula") {
      cleanField.formulaParts = (field.formulaParts || []).map((part) => ({
        id: part.id || uid(),
        categoryId: part.categoryId || "",
        tableId: part.tableId || "",
        fieldName: part.fieldName || "",
        operator: part.operator || "",
      }));
      cleanField.formula = field.formula || "";
      cleanField.roundResult = Boolean(field.roundResult);
    }

    return cleanField;
  }

  function sanitizeTable(table) {
    return {
      id: table.id,
      name: table.name,
      fields: (table.fields || []).map(sanitizeField),
      rows: (table.rows || []).map((row) => ({
        id: row.id,
        values: Object.fromEntries(
          Object.entries(row.values || {}).map(([key, value]) => [key, value ?? ""])
        ),
      })),
    };
  }

  function sanitizeDataForFirestore(nextData) {
    return {
      categories: (nextData.categories || []).map((category) => ({
        id: category.id,
        name: category.name,
        tables: (category.tables || []).map(sanitizeTable),
        quickSummary: {
          tableId: category.quickSummary?.tableId || "",
          fieldName: category.quickSummary?.fieldName || "",
        },
      })),
    };
  }

  async function saveData(nextData) {
    setSaving(true);

    try {
      const cleanData = sanitizeDataForFirestore(nextData);

      await setDoc(
        appDocRef,
        {
          categories: cleanData.categories,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setData(cleanData);
    } catch (error) {
      console.error("Firestore save failed:", error);
      alert(`Save failed: ${error.message}`);
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
      roundResult: false,
      formulaParts: [
        createFormulaPart(selectedCategoryId || "", selectedTableId || "", "", "+"),
        createFormulaPart(selectedCategoryId || "", selectedTableId || "", "", ""),
      ],
    });
    setEditingFieldId(null);
  }

  function addFormulaPart() {
    setFieldForm((prev) => ({
      ...prev,
      formulaParts: [
        ...prev.formulaParts,
        createFormulaPart(selectedCategoryId || "", selectedTableId || "", "", ""),
      ],
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
      formulaParts: prev.formulaParts.map((part) => {
        if (part.id !== partId) return part;

        if (key === "categoryId") {
          return {
            ...part,
            categoryId: value,
            tableId: "",
            fieldName: "",
          };
        }

        if (key === "tableId") {
          return {
            ...part,
            tableId: value,
            fieldName: "",
          };
        }

        return { ...part, [key]: value };
      }),
    }));
  }

  function buildFormulaText(parts) {
    return parts
      .map((part, index) => {
        const categoryName = getCategoryName(part.categoryId);
        const tableName =
          allTables.find((table) => table.id === part.tableId)?.name || "Table";
        const token = `${categoryName}.${tableName}.${part.fieldName || ""}`.trim();

        if (index === parts.length - 1) return token;
        return `${token} ${part.operator || ""}`.trim();
      })
      .join(" ")
      .trim();
  }

  function getNumberInputProps(value, onChange) {
    return {
      type: "number",
      step: "0.01",
      inputMode: "decimal",
      value: value ?? "",
      onChange: (e) => onChange(e.target.value),
    };
  }

  const formulaPreview =
    fieldForm.type === "formula" && fieldForm.name
      ? `${buildFormulaText(fieldForm.formulaParts)} = ${fieldForm.name}`
      : "";

  function toggleTableExpanded(tableId) {
    setExpandedTableIds((prev) =>
      prev.includes(tableId)
        ? prev.filter((id) => id !== tableId)
        : [...prev, tableId]
    );
  }

  function openRenameTableDialog(table) {
    setEditingTableId(table.id);
    setRenameTableForm({ name: table.name || "" });
    openDialog(renameTableDialogRef);
  }

  function openRenameSheetDialog(sheet) {
    setEditingSheetId(sheet.id);
    setRenameSheetForm({ name: sheet.name || "" });
    openDialog(renameSheetDialogRef);
  }

  function openCopyExternalTableDialog() {
    setCopyExternalTableForm({
      sourceSheetId: "",
      sourceTableId: "",
    });
    openDialog(copyExternalTableDialogRef);
  }

  async function saveSheetRename() {
    if (!editingSheetId) return;
    const name = renameSheetForm.name.trim();
    if (!name) return;

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === editingSheetId ? { ...cat, name } : cat
      ),
    };

    await saveData(nextData);
    setEditingSheetId(null);
    setRenameSheetForm({ name: "" });
    closeDialog(renameSheetDialogRef);
  }

  async function saveTableRename() {
    if (!selectedCategory || !editingTableId) return;
    const name = renameTableForm.name.trim();
    if (!name) return;

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              tables: cat.tables.map((table) =>
                table.id === editingTableId ? { ...table, name } : table
              ),
            }
          : cat
      ),
    };

    await saveData(nextData);
    setEditingTableId(null);
    setRenameTableForm({ name: "" });
    closeDialog(renameTableDialogRef);
  }

  async function addSheet() {
    const name = sheetForm.name.trim();
    if (!name) return;

    const newSheet = {
      id: uid(),
      name,
      tables: [],
      quickSummary: {
        tableId: "",
        fieldName: "",
      },
    };

    const nextData = {
      ...data,
      categories: [...data.categories, newSheet],
    };

    await saveData(nextData);
    setSelectedCategoryId(newSheet.id);
    setSelectedTableId(null);
    setSheetForm({ name: "" });
    closeDialog(sheetDialogRef);
  }

  async function copySheet(sheet) {
    const copiedSheet = deepCopySheet(sheet);

    const nextData = {
      ...data,
      categories: [...data.categories, copiedSheet],
    };

    await saveData(nextData);
    setSelectedCategoryId(copiedSheet.id);
    setSelectedTableId(copiedSheet.tables?.[0]?.id || null);
    setExpandedTableIds((prev) => [
      ...prev,
      ...(copiedSheet.tables || []).map((table) => table.id),
    ]);
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
              tables: [...(cat.tables || []), newTable],
            }
          : cat
      ),
    };

    await saveData(nextData);
    setSelectedTableId(newTable.id);
    setExpandedTableIds((prev) => [...new Set([...prev, newTable.id])]);
    setTableForm({ name: "" });
    closeDialog(tableDialogRef);
  }

  async function copyTableWithinSheet(table) {
    if (!selectedCategory || !table) return;

    const copiedTable = deepCopyTable(table, {
      renameTable: true,
      targetCategoryId: selectedCategory.id,
    });

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              tables: [...(cat.tables || []), copiedTable],
            }
          : cat
      ),
    };

    await saveData(nextData);
    setSelectedTableId(copiedTable.id);
    setExpandedTableIds((prev) => [...new Set([...prev, copiedTable.id])]);
  }

  async function copyTableFromAnotherSheet() {
    if (!selectedCategory) return;
    if (!copyExternalTableForm.sourceSheetId || !copyExternalTableForm.sourceTableId) return;

    const sourceSheet = categories.find(
      (cat) => cat.id === copyExternalTableForm.sourceSheetId
    );
    const sourceTable = sourceSheet?.tables?.find(
      (table) => table.id === copyExternalTableForm.sourceTableId
    );

    if (!sourceTable) return;

    const copiedTable = deepCopyTable(sourceTable, {
      renameTable: true,
      targetCategoryId: sourceSheet?.id || "",
    });

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              tables: [...(cat.tables || []), copiedTable],
            }
          : cat
      ),
    };

    await saveData(nextData);
    setSelectedTableId(copiedTable.id);
    setExpandedTableIds((prev) => [...new Set([...prev, copiedTable.id])]);
    closeDialog(copyExternalTableDialogRef);
  }

  async function deleteTable(tableId) {
    if (!selectedCategory) return;

    const remainingTables = selectedCategory.tables.filter((table) => table.id !== tableId);

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              tables: cat.tables.filter((table) => table.id !== tableId),
              quickSummary:
                cat.quickSummary?.tableId === tableId
                  ? { tableId: "", fieldName: "" }
                  : cat.quickSummary || { tableId: "", fieldName: "" },
            }
          : cat
      ),
    };

    await saveData(nextData);
    setExpandedTableIds((prev) => prev.filter((id) => id !== tableId));
    setSelectedTableId(remainingTables[0]?.id || null);
  }

  async function reorderSheets(sourceSheetId, targetSheetId) {
    if (!sourceSheetId || !targetSheetId || sourceSheetId === targetSheetId) return;

    const sourceIndex = data.categories.findIndex((item) => item.id === sourceSheetId);
    const targetIndex = data.categories.findIndex((item) => item.id === targetSheetId);

    const nextData = {
      ...data,
      categories: moveItem(data.categories, sourceIndex, targetIndex),
    };

    await saveData(nextData);
  }

  async function reorderTables(sourceTableId, targetTableId) {
    if (!selectedCategory || !sourceTableId || !targetTableId || sourceTableId === targetTableId) {
      return;
    }

    const tables = selectedCategory.tables || [];
    const sourceIndex = tables.findIndex((item) => item.id === sourceTableId);
    const targetIndex = tables.findIndex((item) => item.id === targetTableId);

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              tables: moveItem(tables, sourceIndex, targetIndex),
            }
          : cat
      ),
    };

    await saveData(nextData);
  }

  function requestDeleteTable(tableId, tableName) {
    openConfirmDialog(
      "Delete Table",
      `Are you sure you want to delete table "${tableName}"?`,
      async () => {
        await deleteTable(tableId);
      }
    );
  }

  function openAddFieldDialog() {
    resetFieldForm();
    openDialog(fieldDialogRef);
  }

  function openEditFieldDialog(field) {
    setEditingFieldId(field.id);
    setFieldForm({
      name: field.name || "",
      type: field.type || "text",
      linkCategoryId: field.linkCategoryId || "",
      linkFieldName: field.linkFieldName || "",
      roundResult: Boolean(field.roundResult),
      formulaParts:
        field.formulaParts?.length > 0
          ? field.formulaParts.map((part, index, arr) => {
              const sourceTable =
                allTables.find((table) => table.id === part.tableId) || null;

              return {
                id: uid(),
                categoryId:
                  part.categoryId ||
                  sourceTable?.categoryId ||
                  selectedCategoryId ||
                  "",
                tableId: part.tableId || selectedTableId || "",
                fieldName: part.fieldName || "",
                operator: index === arr.length - 1 ? "" : part.operator || "+",
              };
            })
          : [
              createFormulaPart(
                selectedCategoryId || "",
                selectedTableId || "",
                "",
                "+"
              ),
              createFormulaPart(
                selectedCategoryId || "",
                selectedTableId || "",
                "",
                ""
              ),
            ],
    });
    openDialog(fieldDialogRef);
  }

  async function saveField() {
    if (!selectedCategory || !selectedTable) return;

    const name = fieldForm.name.trim();
    if (!name) return;

    const existingField = selectedTable.fields.find((f) => f.id === editingFieldId);
    const oldName = existingField?.name;

    const preparedField = {
      id: editingFieldId || uid(),
      name,
      type: fieldForm.type,
    };

    if (fieldForm.type === "formula") {
      const validParts = fieldForm.formulaParts.filter(
        (part) => part.categoryId && part.tableId && part.fieldName
      );
      if (validParts.length < 2) return;

      preparedField.formulaParts = validParts.map((part, index) => ({
        id: uid(),
        categoryId: part.categoryId,
        tableId: part.tableId,
        fieldName: part.fieldName,
        operator: index === validParts.length - 1 ? "" : part.operator || "+",
      }));

      preparedField.formula = buildFormulaText(preparedField.formulaParts);
      preparedField.roundResult = Boolean(fieldForm.roundResult);
    }

    if (fieldForm.type === "link") {
      if (!fieldForm.linkCategoryId || !fieldForm.linkFieldName) return;
      preparedField.linkCategoryId = fieldForm.linkCategoryId;
      preparedField.linkFieldName = fieldForm.linkFieldName;
    }

    const nextData = {
      ...data,
      categories: data.categories.map((cat) => {
        if (cat.id !== selectedCategory.id) return cat;

        return {
          ...cat,
          tables: cat.tables.map((table) => {
            if (table.id !== selectedTable.id) return table;

            const updatedFields = editingFieldId
              ? table.fields.map((fieldItem) =>
                  fieldItem.id === editingFieldId ? preparedField : fieldItem
                )
              : [...table.fields, preparedField];

            const updatedRows = table.rows.map((row) => {
              const nextValues = { ...row.values };

              if (editingFieldId) {
                if (oldName && oldName !== name) {
                  nextValues[name] = nextValues[oldName] ?? "";
                  delete nextValues[oldName];
                } else if (!(name in nextValues)) {
                  nextValues[name] = "";
                }
              } else {
                nextValues[name] = "";
              }

              if (preparedField.type === "formula") {
                delete nextValues[name];
              }

              return {
                ...row,
                values: nextValues,
              };
            });

            const normalizedRows = updatedRows.map((row) => {
              const nextValues = { ...row.values };

              updatedFields.forEach((fieldItem) => {
                if (fieldItem.type !== "formula" && !(fieldItem.name in nextValues)) {
                  nextValues[fieldItem.name] = "";
                }
              });

              Object.keys(nextValues).forEach((key) => {
                const stillExists = updatedFields.some(
                  (fieldItem) => fieldItem.name === key && fieldItem.type !== "formula"
                );
                if (!stillExists) {
                  delete nextValues[key];
                }
              });

              return {
                ...row,
                values: nextValues,
              };
            });

            return {
              ...table,
              fields: updatedFields,
              rows: normalizedRows,
            };
          }),
          quickSummary:
            cat.quickSummary?.tableId === selectedTable.id &&
            cat.quickSummary?.fieldName === oldName
              ? {
                  tableId: selectedTable.id,
                  fieldName: name,
                }
              : cat.quickSummary || { tableId: "", fieldName: "" },
        };
      }),
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
              tables: cat.tables.map((table) =>
                table.id === selectedTable.id
                  ? {
                      ...table,
                      rows: [...table.rows, newRow],
                    }
                  : table
              ),
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
              tables: cat.tables.map((table) =>
                table.id === selectedTable.id
                  ? {
                      ...table,
                      rows: table.rows.map((row) =>
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
                    }
                  : table
              ),
            }
          : cat
      ),
    };

    await saveData(nextData);
  }

  function getCategoryById(categoryId) {
    return categories.find((cat) => cat.id === categoryId);
  }

  function getTableById(tableId) {
    return allTables.find((table) => table.id === tableId);
  }

  function evaluateFormulaField(row, field, tableContext, visited = new Set()) {
    if (!field) return 0;

    const visitKey = `${tableContext?.id || "table"}::${field.name}`;
    if (visited.has(visitKey)) return 0;
    visited.add(visitKey);

    if (field.type === "number") {
      return Number(row?.values?.[field.name] || 0);
    }

    if (field.type === "formula" && field.formulaParts?.length) {
      let total = 0;

      field.formulaParts.forEach((part, index) => {
        const sourceTable = getTableById(part.tableId || tableContext?.id);
        const sourceField = sourceTable?.fields?.find((f) => f.name === part.fieldName);
        const sourceRow = sourceTable?.rows?.[0] || row;

        let partValue = 0;

        if (sourceField) {
          if (sourceField.type === "formula") {
            partValue = evaluateFormulaField(
              sourceRow,
              sourceField,
              sourceTable,
              new Set(visited)
            );
          } else {
            partValue = Number(sourceRow?.values?.[sourceField.name] || 0);
          }
        }

        if (index === 0) {
          total = partValue;
        } else {
          const previousOperator = field.formulaParts[index - 1]?.operator || "+";
          if (previousOperator === "+") total += partValue;
          if (previousOperator === "-") total -= partValue;
          if (previousOperator === "*") total *= partValue;
          if (previousOperator === "/") {
            total = partValue === 0 ? 0 : total / partValue;
          }
        }
      });

      return Number.isFinite(total) ? total : 0;
    }

    return 0;
  }

  function getFormulaValue(row, field, tableContext = selectedTable) {
    if (!field?.formulaParts?.length) return "";

    const result = evaluateFormulaField(row, field, tableContext);

    if (field.roundResult) {
      return Number(result).toFixed(2);
    }

    return Number.isFinite(result) ? result : "";
  }

  function getLinkedDisplayValue(row, field) {
    const linkValue = row.values[field.name];
    if (!linkValue) return "";

    const [categoryId, rowId] = String(linkValue).split(":");
    const linkedCategory = getCategoryById(categoryId);
    const linkedTable = linkedCategory?.tables?.[0];
    if (!linkedTable) return "";

    const linkedRow = linkedTable.rows.find((r) => r.id === rowId);
    if (!linkedRow) return "";

    return linkedRow.values[field.linkFieldName] || "";
  }

  function getLinkOptions(field) {
    const linkedCategory = getCategoryById(field.linkCategoryId);
    const linkedTable = linkedCategory?.tables?.[0];
    if (!linkedTable) return [];

    const labelField = field.linkFieldName || linkedTable.fields[0]?.name || "Name";

    return linkedTable.rows.map((row) => ({
      value: `${linkedCategory.id}:${row.id}`,
      label: row.values[labelField] || "(blank)",
    }));
  }

  function getTableQuickValue(table) {
    if (!tableQuickField) return "";
    const quickField = (table.fields || []).find((field) => field.name === tableQuickField);
    const firstRow = table.rows?.[0];

    if (!quickField || !firstRow) return "";

    return quickField.type === "formula"
      ? getFormulaValue(firstRow, quickField, table)
      : firstRow.values?.[quickField.name] || "";
  }

  async function saveSheetQuickTable(tableId) {
    if (!selectedCategory) return;

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              quickSummary: {
                tableId,
                fieldName: "",
              },
            }
          : cat
      ),
    };

    await saveData(nextData);
  }

  async function saveSheetQuickField(fieldName) {
    if (!selectedCategory) return;

    const currentTableId = selectedCategory.quickSummary?.tableId || "";

    const nextData = {
      ...data,
      categories: data.categories.map((cat) =>
        cat.id === selectedCategory.id
          ? {
              ...cat,
              quickSummary: {
                tableId: currentTableId,
                fieldName,
              },
            }
          : cat
      ),
    };

    await saveData(nextData);
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
        setSelectedTableId(remaining[0]?.tables?.[0]?.id || null);
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
                  tables: cat.tables.map((table) =>
                    table.id === selectedTable.id
                      ? {
                          ...table,
                          fields: table.fields.filter((field) => field.name !== fieldName),
                          rows: table.rows.map((row) => {
                            const nextValues = { ...row.values };
                            delete nextValues[fieldName];
                            return { ...row, values: nextValues };
                          }),
                        }
                      : table
                  ),
                  quickSummary:
                    cat.quickSummary?.tableId === selectedTable.id &&
                    cat.quickSummary?.fieldName === fieldName
                      ? { tableId: "", fieldName: "" }
                      : cat.quickSummary || { tableId: "", fieldName: "" },
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
                tables: cat.tables.map((table) =>
                  table.id === selectedTable.id
                    ? {
                        ...table,
                        rows: table.rows.filter((row) => row.id !== rowId),
                      }
                    : table
                ),
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
        setSelectedTableId(null);
        setExpandedTableIds([]);
        setTableQuickField("");
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
            {categories.map((category) => {
              const sheetValue = getSheetSummaryForCategory(category);

              return (
                <div
                  key={category.id}
                  className={`sheet-item sheet-card ${
                    selectedCategoryId === category.id ? "active-sheet" : ""
                  } ${dragSheetId === category.id ? "dragging-card" : ""}`}
                  draggable
                  onDragStart={() => setDragSheetId(category.id)}
                  onDragEnd={() => setDragSheetId(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={async () => {
                    await reorderSheets(dragSheetId, category.id);
                    setDragSheetId(null);
                  }}
                >
                  <button
                    className="sheet-btn sheet-btn-block"
                    onClick={() => {
                      setSelectedCategoryId(category.id);
                      setSelectedTableId(category.tables?.[0]?.id || null);
                    }}
                    title={category.name}
                  >
                    <span className="sheet-btn-name sheet-btn-name-full">{category.name}</span>
                  </button>

                  <div className="sheet-card-value">
                    {sheetValue !== "" ? sheetValue : <span className="sheet-card-empty">—</span>}
                  </div>

                  <div className="sheet-card-actions">
                    <button
                      type="button"
                      className="field-mini-btn"
                      onClick={() => openRenameSheetDialog(category)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="field-mini-btn"
                      onClick={() => copySheet(category)}
                    >
                      Copy
                    </button>
                    <button
                      className="delete-mini"
                      type="button"
                      onClick={() => requestDeleteSheet(category.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
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
                <div className="topbar-main">
                  <div className="sheet-header-block">
                    <div className="sheet-header-top">
                      <p className="eyebrow">Sheet</p>
                      <span className="drag-hint">Drag sheets/tables to sort</span>
                    </div>

                    <div className="sheet-title-row">
                      <h2>{selectedCategory.name}</h2>

                      {selectedSheetQuickSummary?.field &&
                        selectedSheetQuickSummary?.value !== "" && (
                          <div className="sheet-title-value">
                            <span className="sheet-title-value-label">
                              {selectedSheetQuickSummary.tableName} ·{" "}
                              {selectedSheetQuickSummary.field}
                            </span>
                            <strong>{selectedSheetQuickSummary.value}</strong>
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="summary-tools">
                    <div className="summary-config">
                      <label>Sheet quick table</label>
                      <select
                        value={selectedSheetQuickConfig.tableId}
                        onChange={(e) => saveSheetQuickTable(e.target.value)}
                      >
                        <option value="">None</option>
                        {sheetQuickTableOptions.map((table) => (
                          <option key={table.id} value={table.id}>
                            {table.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="summary-config">
                      <label>Sheet quick field</label>
                      <select
                        value={selectedSheetQuickConfig.fieldName}
                        onChange={(e) => saveSheetQuickField(e.target.value)}
                        disabled={!selectedSheetQuickConfig.tableId}
                      >
                        <option value="">None</option>
                        {sheetQuickFieldOptions.map((fieldName) => (
                          <option key={fieldName} value={fieldName}>
                            {fieldName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button onClick={() => openDialog(tableDialogRef)}>Add Table</button>
                    <button type="button" onClick={openCopyExternalTableDialog}>
                      Copy Table From Sheet
                    </button>
                  </div>
                </div>
              </header>

              {selectedCategory.tables?.length > 0 && (
                <>
                  <section className="global-table-quick-bar">
                    <div className="summary-config global-table-quick-config">
                      <label>Table quick field</label>
                      <select
                        value={tableQuickField}
                        onChange={(e) => setTableQuickField(e.target.value)}
                      >
                        <option value="">None</option>
                        {allCurrentSheetFieldNames.map((fieldName) => (
                          <option key={fieldName} value={fieldName}>
                            {fieldName}
                          </option>
                        ))}
                      </select>
                    </div>
                  </section>

                  <section className="table-accordion-list">
                    {selectedCategory.tables.map((table) => {
                      const isExpanded = expandedTableIds.includes(table.id);
                      const isSelected = selectedTableId === table.id;
                      const quickValue = getTableQuickValue(table);

                      return (
                        <div
                          key={table.id}
                          className={`table-accordion-item ${
                            isSelected ? "active-table-accordion" : ""
                          } ${dragTableId === table.id ? "dragging-card" : ""}`}
                          draggable
                          onDragStart={() => setDragTableId(table.id)}
                          onDragEnd={() => setDragTableId(null)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={async () => {
                            await reorderTables(dragTableId, table.id);
                            setDragTableId(null);
                          }}
                        >
                          <div className="table-accordion-header">
                            <button
                              type="button"
                              className="table-accordion-toggle"
                              onClick={() => {
                                setSelectedTableId(table.id);
                                toggleTableExpanded(table.id);
                              }}
                            >
                              <span>{isExpanded ? "▾" : "▸"}</span>

                              <div className="table-title-stack">
                                <div className="table-title-row table-title-row-left">
                                  <span className="table-title-text">{table.name}</span>
                                  {tableQuickField && quickValue !== "" && (
                                    <span className="table-header-value table-header-value-inline">
                                      {quickValue}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>

                            <div className="field-pill-buttons">
                              <button
                                type="button"
                                className="field-mini-btn"
                                onClick={() => {
                                  setSelectedTableId(table.id);
                                  openRenameTableDialog(table);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="field-mini-btn"
                                onClick={() => {
                                  setSelectedTableId(table.id);
                                  copyTableWithinSheet(table);
                                }}
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                className="delete-mini"
                                onClick={() => requestDeleteTable(table.id, table.name)}
                              >
                                ×
                              </button>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="table-accordion-body">
                              <div className="table-toolbar">
                                <div className="topbar-actions">
                                  <button
                                    onClick={() => {
                                      setSelectedTableId(table.id);
                                      openAddFieldDialog();
                                    }}
                                  >
                                    Add Field
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSelectedTableId(table.id);
                                      openAddRowDialog();
                                    }}
                                  >
                                    Add Row
                                  </button>
                                </div>
                              </div>

                              <section className="field-strip">
                                {table.fields.map((field) => (
                                  <div key={field.id} className="field-pill field-pill-actions">
                                    <span>
                                      {field.name} ({field.type})
                                    </span>
                                    <div className="field-pill-buttons">
                                      <button
                                        type="button"
                                        className="field-mini-btn"
                                        onClick={() => {
                                          setSelectedTableId(table.id);
                                          openEditFieldDialog(field);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedTableId(table.id);
                                          requestDeleteField(field.name);
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </section>

                              <section className="table-wrap">
                                <table>
                                  <thead>
                                    <tr>
                                      {table.fields.map((field) => (
                                        <th key={field.id}>{field.name}</th>
                                      ))}
                                      <th>Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {table.rows.length === 0 ? (
                                      <tr>
                                        <td colSpan={table.fields.length + 1}>
                                          <div className="empty-inline">
                                            No rows yet. Click Add Row.
                                          </div>
                                        </td>
                                      </tr>
                                    ) : (
                                      table.rows.map((row) => (
                                        <tr key={row.id}>
                                          {table.fields.map((field) => (
                                            <td key={field.id}>
                                              {field.type === "formula" ? (
                                                <div className="formula-cell">
                                                  {getFormulaValue(row, field, table)}
                                                </div>
                                              ) : field.type === "link" ? (
                                                <div className="link-cell">
                                                  <select
                                                    value={row.values[field.name] || ""}
                                                    onChange={(e) => {
                                                      setSelectedTableId(table.id);
                                                      updateCell(
                                                        row.id,
                                                        field.name,
                                                        e.target.value
                                                      );
                                                    }}
                                                  >
                                                    <option value="">Select linked row</option>
                                                    {getLinkOptions(field).map((option) => (
                                                      <option
                                                        key={option.value}
                                                        value={option.value}
                                                      >
                                                        {option.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                  <small>
                                                    Showing:{" "}
                                                    {getLinkedDisplayValue(row, field) || "-"}
                                                  </small>
                                                </div>
                                              ) : field.type === "number" ? (
                                                <input
                                                  {...getNumberInputProps(
                                                    row.values[field.name],
                                                    (value) => {
                                                      setSelectedTableId(table.id);
                                                      updateCell(row.id, field.name, value);
                                                    }
                                                  )}
                                                />
                                              ) : (
                                                <input
                                                  type="text"
                                                  value={row.values[field.name] || ""}
                                                  onChange={(e) => {
                                                    setSelectedTableId(table.id);
                                                    updateCell(
                                                      row.id,
                                                      field.name,
                                                      e.target.value
                                                    );
                                                  }}
                                                />
                                              )}
                                            </td>
                                          ))}
                                          <td>
                                            <button
                                              className="danger-text"
                                              type="button"
                                              onClick={() => {
                                                setSelectedTableId(table.id);
                                                requestDeleteRow(row.id);
                                              }}
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
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>
                </>
              )}

              {selectedCategory.tables?.length === 0 && (
                <section className="empty-state">
                  <h3>No table yet</h3>
                  <p>Create a table under this sheet first.</p>
                  <div className="empty-actions">
                    <button onClick={() => openDialog(tableDialogRef)}>
                      Add Table
                    </button>
                  </div>
                </section>
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
        dialogRef={renameSheetDialogRef}
        title="Edit Sheet Name"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(renameSheetDialogRef)}
            >
              Cancel
            </button>
            <button type="button" onClick={saveSheetRename}>
              Save
            </button>
          </>
        }
      >
        <label className="field-block">
          <span>Sheet name</span>
          <input
            type="text"
            value={renameSheetForm.name}
            onChange={(e) => setRenameSheetForm({ name: e.target.value })}
            placeholder="Sheet name"
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
        dialogRef={renameTableDialogRef}
        title="Edit Table Name"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(renameTableDialogRef)}
            >
              Cancel
            </button>
            <button type="button" onClick={saveTableRename}>
              Save
            </button>
          </>
        }
      >
        <label className="field-block">
          <span>Table name</span>
          <input
            type="text"
            value={renameTableForm.name}
            onChange={(e) => setRenameTableForm({ name: e.target.value })}
            placeholder="Table name"
          />
        </label>
      </DialogBox>

      <DialogBox
        dialogRef={copyExternalTableDialogRef}
        title="Copy Table From Another Sheet"
        actions={
          <>
            <button
              className="secondary-btn"
              type="button"
              onClick={() => closeDialog(copyExternalTableDialogRef)}
            >
              Cancel
            </button>
            <button type="button" onClick={copyTableFromAnotherSheet}>
              Copy Table
            </button>
          </>
        }
      >
        <div className="dialog-grid">
          <label className="field-block">
            <span>Source sheet</span>
            <select
              value={copyExternalTableForm.sourceSheetId}
              onChange={(e) =>
                setCopyExternalTableForm({
                  sourceSheetId: e.target.value,
                  sourceTableId: "",
                })
              }
            >
              <option value="">Select sheet</option>
              {externalSheetOptions.map((sheet) => (
                <option key={sheet.id} value={sheet.id}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-block">
            <span>Source table</span>
            <select
              value={copyExternalTableForm.sourceTableId}
              onChange={(e) =>
                setCopyExternalTableForm((prev) => ({
                  ...prev,
                  sourceTableId: e.target.value,
                }))
              }
              disabled={!copyExternalTableForm.sourceSheetId}
            >
              <option value="">Select table</option>
              {externalTableOptions.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </DialogBox>

      <DialogBox
        dialogRef={fieldDialogRef}
        title={editingFieldId ? "Edit Field" : "Add Field"}
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
            <button type="button" onClick={saveField}>
              {editingFieldId ? "Update Field" : "Save Field"}
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
                  roundResult: false,
                  formulaParts: [
                    createFormulaPart(
                      selectedCategoryId || "",
                      selectedTableId || "",
                      "",
                      "+"
                    ),
                    createFormulaPart(
                      selectedCategoryId || "",
                      selectedTableId || "",
                      "",
                      ""
                    ),
                  ],
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
              {fieldForm.formulaParts.map((part, index) => {
                const categoryTables = getFormulaTablesForCategory(part.categoryId);
                const tableFields = getFormulaFieldsForTable(part.tableId, true);

                return (
                  <div key={part.id} className="formula-row formula-row-wide">
                    <label className="field-block">
                      <span>Sheet</span>
                      <select
                        value={part.categoryId}
                        onChange={(e) =>
                          updateFormulaPart(part.id, "categoryId", e.target.value)
                        }
                      >
                        <option value="">Select sheet</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-block">
                      <span>Table</span>
                      <select
                        value={part.tableId}
                        onChange={(e) =>
                          updateFormulaPart(part.id, "tableId", e.target.value)
                        }
                        disabled={!part.categoryId}
                      >
                        <option value="">Select table</option>
                        {categoryTables.map((tableOption) => (
                          <option key={tableOption.id} value={tableOption.id}>
                            {tableOption.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="field-block">
                      <span>Field {index + 1}</span>
                      <select
                        value={part.fieldName}
                        onChange={(e) =>
                          updateFormulaPart(part.id, "fieldName", e.target.value)
                        }
                        disabled={!part.tableId}
                      >
                        <option value="">Select field</option>
                        {tableFields.map((field) => (
                          <option key={field.id} value={field.name}>
                            {field.name} ({field.type})
                          </option>
                        ))}
                      </select>
                    </label>

                    {index < fieldForm.formulaParts.length - 1 ? (
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
                    ) : (
                      <div />
                    )}

                    <button
                      type="button"
                      className="remove-part-btn"
                      onClick={() => removeFormulaPart(part.id)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}

              <div className="formula-actions">
                <button type="button" onClick={addFormulaPart}>
                  + Add Another Field
                </button>
              </div>

              <label className="field-block">
                <span>Rounding</span>
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={fieldForm.roundResult}
                    onChange={(e) =>
                      setFieldForm((prev) => ({
                        ...prev,
                        roundResult: e.target.checked,
                      }))
                    }
                    style={{ width: "auto" }}
                  />
                  Round result to 2 decimal places
                </label>
              </label>

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
                    .filter((cat) => cat.id !== selectedCategoryId && cat.tables?.length)
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
                    {...getNumberInputProps(rowForm[field.name], (value) =>
                      setRowForm((prev) => ({
                        ...prev,
                        [field.name]: value,
                      }))
                    )}
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