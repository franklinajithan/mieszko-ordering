import argparse
import sys
import subprocess
import re
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from openpyxl.styles import PatternFill, Font
from openpyxl.formatting.rule import CellIsRule


# =============================
# CLI: Dynamic input files & sheet names
# =============================
def parse_args():
    p = argparse.ArgumentParser(
        description="Build 'Wastage vs Sales' workbook outputs from dynamic input files."
    )
    p.add_argument(
        "--wastage",
        required=False,
        default="Wastage.xlsx",
        help="Path to Wastage .xls or .xlsx file. Legacy .xls is automatically converted to .xlsx.",
    )
    p.add_argument(
        "--rtc",
        required=False,
        default="RTC.xlsx",
        help="Path to RTC .xls or .xlsx file. Legacy .xls is automatically converted to .xlsx.",
    )
    p.add_argument(
        "--sales",
        required=False,
        default="Sales.xlsx",
        help="Path to Sales .xls or .xlsx file. Legacy .xls is automatically converted to .xlsx.",
    )
    # Optional explicit sheet names to avoid misnaming/mismatch
    p.add_argument(
        "--wastage-sheet",
        required=False,
        default=None,
        help="Exact sheet name for the wastage file (case-insensitive match).",
    )
    p.add_argument(
        "--rtc-sheet",
        required=False,
        default=None,
        help="Exact sheet name for the RTC file (case-insensitive match).",
    )
    p.add_argument(
        "--sales-sheet",
        required=False,
        default=None,
        help="Exact sheet name for the Sales file (case-insensitive match).",
    )
    return p.parse_args()



def convert_xls_to_xlsx(path: Path, label: str) -> Path:
    """Convert legacy exports with a private LibreOffice profile."""
    path = path.resolve()
    if path.suffix.lower() != ".xls":
        return path

    from tempfile import TemporaryDirectory
    from zipfile import is_zipfile

    output = path.with_suffix(".xlsx")
    if is_zipfile(path):
        path.replace(output)
    else:
        with TemporaryDirectory(dir=path.parent) as temp:
            workspace = Path(temp)
            subprocess.run(
                ["libreoffice", f"-env:UserInstallation={(workspace / 'profile').as_uri()}",
                 "--headless", "--convert-to", "xlsx", "--outdir", temp, str(path)],
                capture_output=True, check=True, timeout=180,
            )
            converted = workspace / output.name
            if not is_zipfile(converted):
                raise ValueError(f"Could not convert {label} to XLSX")
            converted.replace(output)
        path.unlink()
    return output


def convert_daily_sales_in_store_folder(reference_file: Path) -> None:
    """
    Convert any legacy Daily Sales by Department .xls file in the same
    store folder to .xlsx and remove the original .xls.

    This report is not used by the wastage calculations, but keeping it
    in the same final format avoids duplicate/mixed .xls and .xlsx files.
    """
    folder = Path(reference_file).resolve().parent

    patterns = [
        "*_Daily_Sales_by_Department_*.xls",
        "*Daily_Sales_by_Department*.xls",
    ]

    found = []

    for pattern in patterns:
        for file_path in folder.glob(pattern):
            if file_path not in found:
                found.append(file_path)

    for file_path in found:
        try:
            convert_xls_to_xlsx(
                file_path,
                "Daily Sales by Department"
            )
        except Exception as exc:
            # Daily Sales is not required for the Wastage vs Sales calculations,
            # so report the issue without stopping the main processing.
            print(
                f"⚠️ Could not convert Daily Sales file "
                f"{file_path.name}: {exc}"
            )


def ensure_required_file(path_str: str, label: str) -> Path:
    """Stop script if required file is missing."""
    path = Path(path_str)
    if not path.exists():
        sys.exit(f"❌ {label} not found: {path}")
    return path


def ensure_optional_file(path_str: str, label: str) -> Path | None:
    """Return Path if exists; otherwise return None (do NOT stop script)."""
    path = Path(path_str)
    if not path.exists():
        print(f"⚠️ {label} not found: {path} → skipping {label} steps.")
        return None
    return path


def pick_sheet(
    xl: pd.ExcelFile, desired_name_ci: str | None, fallback_contains: str | None = None
) -> str:
    """
    Pick a sheet by exact (case-insensitive) name if provided.
    Otherwise, search by 'fallback_contains' (case-insensitive).
    Raise if not found to avoid sheet-name mismatches.
    """
    if desired_name_ci:
        for s in xl.sheet_names:
            if s.strip().lower() == desired_name_ci.strip().lower():
                return s
        raise ValueError(
            f"Worksheet named '{desired_name_ci}' not found. Available: {xl.sheet_names}"
        )

    if fallback_contains:
        for s in xl.sheet_names:
            if fallback_contains.strip().lower() in s.strip().lower():
                return s

    raise ValueError(
        f"No suitable worksheet found. Available sheets: {xl.sheet_names}. "
        f"Provide an explicit --*-sheet argument."
    )


def explicit_no_records(frame, sheet_name, report_name):
    """Recognize CRM's explicit empty message in a report with the expected title."""
    cells = {
        re.sub(r"[^a-z0-9]", "", str(value).lower())
        for row in frame.head(20).itertuples(index=False, name=None)
        for value in row if pd.notna(value)
    }
    sheet = re.sub(r"[^a-z0-9]", "", sheet_name.lower())
    return "norecordsavailable" in cells and any(
        report_name in value for value in cells | {sheet}
    )


def main():
    args = parse_args()

    # -----------------------------
    # Paths (dynamic)
    # -----------------------------
    wastage_path = ensure_required_file(args.wastage, "Wastage file")  # REQUIRED
    rtc_path = ensure_optional_file(args.rtc, "RTC file")  # OPTIONAL
    sales_path = ensure_optional_file(args.sales, "Sales file")  # OPTIONAL

    # ---------------------------------------------------------
    # CRM exports are normally legacy .xls files.
    # Convert them to real .xlsx before pandas/openpyxl processing.
    # ---------------------------------------------------------

    wastage_path = convert_xls_to_xlsx(
        wastage_path,
        "Wastage file"
    )

    if rtc_path is not None:
        rtc_path = convert_xls_to_xlsx(
            rtc_path,
            "RTC file"
        )

    if sales_path is not None:
        sales_path = convert_xls_to_xlsx(
            sales_path,
            "Sales file"
        )

    # ---------------------------------------------------------
    # Convert Daily Sales by Department in this store folder too
    # so the final folder contains only .xlsx Excel files.
    # ---------------------------------------------------------
    convert_daily_sales_in_store_folder(
        wastage_path
    )

    wastage_file = str(wastage_path)
    rtc_file = str(rtc_path) if rtc_path else None
    sales_file = str(sales_path) if sales_path else None

    rtc_available = rtc_path is not None
    sales_available = sales_path is not None

    print("")
    print("============================================================")
    print("PROCESSING FILES")
    print("============================================================")
    print(f"Wastage: {wastage_file}")
    if rtc_available:
        print(f"RTC:     {rtc_file}")
    if sales_available:
        print(f"Sales:   {sales_file}")
    print("============================================================")
    print("")

    # -----------------------------
    # Load Wastage Excel
    # -----------------------------
    excel_file = pd.ExcelFile(wastage_file)
    # Prefer explicit sheet name; fallback to a sheet that contains "wastagereport"
    target_sheet = pick_sheet(excel_file, args.wastage_sheet, fallback_contains="wastage")

    # -----------------------------
    # Read Wastage data
    # -----------------------------
    raw = pd.read_excel(wastage_file, sheet_name=target_sheet, header=None)

    if explicit_no_records(raw, target_sheet, "wastage"):
        raw = pd.DataFrame([["Product Code", "Description", "Item Group", "Qty", "Amount", "Cost"]])

    # ---------------------------------------------------------
    # ROBUST HEADER DETECTION
    #
    # Different CRM exports can call the product code column:
    #   Product Code
    #   ProductCode
    #   Item Code
    #   ItemCode
    #   Code
    #
    # Detect those variants and then rename the detected column
    # back to "Product Code" so the rest of this script can keep
    # using one standard column name.
    # ---------------------------------------------------------
    def _normalise_header_value(value):
        if pd.isna(value):
            return ""
        value = str(value).strip().lower()
        value = re.sub(r"[\s_\-]+", "", value)
        return value

    product_code_aliases = {
        "productcode",
        "itemcode",
        "code",
    }

    header_row_idx = None
    detected_product_code_header = None

    for idx, row in raw.iterrows():
        normalised_values = [_normalise_header_value(v) for v in row.tolist()]

        # Prefer rows that look like a genuine table header rather
        # than matching an isolated word elsewhere in the report.
        has_code = any(v in product_code_aliases for v in normalised_values)
        has_description = any("description" in v for v in normalised_values)
        has_qty = any(v in {"qty", "quantity"} for v in normalised_values)
        has_amount_or_cost = any(
            v in {"amount", "cost", "retail", "value"}
            or "amount" in v
            or "cost" in v
            for v in normalised_values
        )

        if has_code and (has_description or has_qty or has_amount_or_cost):
            header_row_idx = idx

            for original_value, normalised_value in zip(
                row.tolist(), normalised_values
            ):
                if normalised_value in product_code_aliases:
                    detected_product_code_header = str(original_value).strip()
                    break

            break

    # Fallback: accept any row containing one of the known code aliases.
    if header_row_idx is None:
        for idx, row in raw.iterrows():
            normalised_values = [_normalise_header_value(v) for v in row.tolist()]

            if any(v in product_code_aliases for v in normalised_values):
                header_row_idx = idx

                for original_value, normalised_value in zip(
                    row.tolist(), normalised_values
                ):
                    if normalised_value in product_code_aliases:
                        detected_product_code_header = str(original_value).strip()
                        break

                break

    if header_row_idx is None:
        print("")
        print("ERROR: Could not identify the Wastage table header.")
        print("Sheet:", target_sheet)
        print("First non-empty rows found:")

        shown = 0
        for idx, row in raw.iterrows():
            values = [
                str(v).strip()
                for v in row.tolist()
                if not pd.isna(v) and str(v).strip()
            ]
            if values:
                print(f"  Row {idx + 1}: {' | '.join(values[:12])}")
                shown += 1
                if shown >= 12:
                    break

        raise ValueError(
            "Wastage header not found. Expected Product Code, "
            "Item Code, ProductCode, ItemCode or Code."
        )

    print(
        f"✅ Wastage header detected on Excel row {header_row_idx + 1}"
    )

    if detected_product_code_header:
        print(
            f"✅ Product code column detected as: "
            f"{detected_product_code_header}"
        )

    columns = []
    for value in raw.iloc[header_row_idx].tolist():
        if pd.isna(value):
            columns.append("")
        else:
            columns.append(str(value).strip())

    # Standardise the detected code column to "Product Code".
    standardised_columns = []
    product_code_renamed = False

    for column in columns:
        normalised_column = _normalise_header_value(column)

        if (
            not product_code_renamed
            and normalised_column in product_code_aliases
        ):
            standardised_columns.append("Product Code")
            product_code_renamed = True
        else:
            standardised_columns.append(column)

    columns = standardised_columns

    # Make duplicate/blank column names safe for pandas.
    seen_columns = {}
    safe_columns = []

    for position, column in enumerate(columns, start=1):
        base_name = column if column else f"Unnamed_{position}"

        if base_name not in seen_columns:
            seen_columns[base_name] = 0
            safe_columns.append(base_name)
        else:
            seen_columns[base_name] += 1
            safe_columns.append(
                f"{base_name}_{seen_columns[base_name]}"
            )

    df = raw.iloc[header_row_idx + 1 :].copy()
    df.columns = safe_columns
    df = df.dropna(how="all")
    df = df.replace(r"^\s*$", pd.NA, regex=True)

    # ---------------------------------------------------------
    # STANDARDISE CURRENT CRM WASTAGE EXPORT COLUMN NAMES
    #
    # Current Wastage report uses:
    #   Item Code -> Product Code
    #   EAN       -> Barcode
    #
    # Product Code is already normalised above.  Normalise EAN
    # here because the rest of this script expects "Barcode".
    # ---------------------------------------------------------
    rename_columns = {}

    for col in df.columns:
        norm_col = re.sub(r"[\s_\-]+", "", str(col).strip().lower())

        if norm_col in {"ean", "eancode", "barcode", "barcodeno", "barcodenumber"}:
            if "Barcode" not in df.columns:
                rename_columns[col] = "Barcode"

    if rename_columns:
        df.rename(columns=rename_columns, inplace=True)

    print("✅ Wastage columns detected:")
    print("   " + " | ".join(str(c) for c in df.columns))

    if "Product Code" not in df.columns:
        raise ValueError(
            "A Wastage header row was detected, but the product/item "
            "code column could not be standardised to 'Product Code'."
        )

    # -----------------------------
    # Parse reasons for store use
    # -----------------------------
    first_col_name = df.columns[0]
    first_col_text = df[first_col_name].astype(str).fillna("")

    marker_mask = first_col_text.str.strip().str.lower().str.startswith("reason")
    subtotal_mask = first_col_text.str.strip().str.lower().str.startswith("total for")

    reason_desc = first_col_text.str.extract(r"(?i)reason\s*description\s*:\s*(.+)", expand=False)
    parsed_reason = reason_desc.where(marker_mask).ffill()

    move_reasons = {
        "Stock Correction (+)",
        "Stock Correction (-)",
        "Store Use",
        "Store Transfers (Out)",
        "Store Transfers (In)",
        "Transfers",
	"Stock take corrections +",
	"Stock take corrections -",
    }
    move_reasons_normalized = {s.strip().lower() for s in move_reasons}

    reason_norm_full = parsed_reason.fillna("").astype(str).str.strip().str.lower()
    subtotal_reason = first_col_text.str.extract(r"(?i)^total\s*for\s*(.+?)\s*:", expand=False)
    subtotal_reason_norm = subtotal_reason.fillna("").astype(str).str.strip().str.lower()

    store_mask = reason_norm_full.isin(move_reasons_normalized) | (
        subtotal_mask & subtotal_reason_norm.isin(move_reasons_normalized)
    )

    df_store_use = df[store_mask].copy()
    df_items_remaining = df[(~store_mask) & (~marker_mask) & (~subtotal_mask)].copy()

    description_col = next(
        (c for c in df_items_remaining.columns if "description" in str(c).strip().lower()),
        None,
    )
    if description_col and not df_items_remaining.empty:
        desc_series = df_items_remaining[description_col].astype(str).str.strip()
        empty_desc_mask = desc_series.eq("") | desc_series.str.lower().eq("nan")
        df_items_remaining = df_items_remaining[~empty_desc_mask].copy()

    for part in (df_store_use, df_items_remaining):
        part.replace(r"^\s*$", pd.NA, regex=True, inplace=True)

    # -----------------------------
    # Coerce numeric columns
    # -----------------------------
    def coerce_numeric_columns(frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            return frame

        normalized_map = {col: str(col).strip().lower() for col in frame.columns}

        qty_col_local = next((c for c, n in normalized_map.items() if n in ("qty", "quantity")), None)
        if qty_col_local:
            frame[qty_col_local] = pd.to_numeric(frame[qty_col_local], errors="coerce")

        code_col = next(
            (
                c
                for c, n in normalized_map.items()
                if "barcode" in n or n == "item code" or n == "code"
            ),
            None,
        )
        if code_col:
            series = frame[code_col].astype(str).str.strip()
            is_digits = series.str.match(r"^\d+$")
            numeric_vals = pd.to_numeric(series.where(is_digits), errors="coerce")
            series.loc[is_digits] = numeric_vals.loc[is_digits]
            frame[code_col] = series

        prod_code_col = next((c for c, n in normalized_map.items() if n == "product code"), None)
        if prod_code_col:
            series = frame[prod_code_col].astype(str).str.strip()
            is_digits = series.str.match(r"^\d+$")
            numeric_vals = pd.to_numeric(series.where(is_digits), errors="coerce")
            series.loc[is_digits] = numeric_vals.loc[is_digits]
            frame[prod_code_col] = series

        amount_col_local = next((c for c, n in normalized_map.items() if n == "amount"), None)
        if amount_col_local:
            frame[amount_col_local] = pd.to_numeric(frame[amount_col_local], errors="coerce")

        cost_col_local = next((c for c, n in normalized_map.items() if n == "cost"), None)
        if cost_col_local:
            frame[cost_col_local] = pd.to_numeric(frame[cost_col_local], errors="coerce")

        return frame

    def normalize_barcode_inplace(frame: pd.DataFrame, column_name: str) -> None:
        """Ensure barcode-like column is clean string (no trailing .0, no 'nan')."""
        if column_name in frame.columns:
            s = frame[column_name].astype(str).str.strip()
            s = s.str.replace(r"^nan$", "", regex=True, case=False)
            s = s.str.replace(r"\.0+$", "", regex=True)
            frame[column_name] = s.astype(object)

    def normalize_code_key(series: pd.Series) -> pd.Series:
        """Return a comparable string key for code columns (strip, no trailing .0)."""
        s = series.astype(str).str.strip()
        return s.str.replace(r"\.0+$", "", regex=True)

    df_store_use = coerce_numeric_columns(df_store_use)
    df_items_remaining = coerce_numeric_columns(df_items_remaining)

    # -----------------------------
    # Dept Breakdown
    # -----------------------------
    norm_map = {col: str(col).strip().lower() for col in df_items_remaining.columns}
    item_group_col = next(
        (c for c, n in norm_map.items() if n == "item group" or ("item" in n and "group" in n)),
        None,
    )
    qty_col = next((c for c, n in norm_map.items() if n in ("qty", "quantity")), None)
    amount_col = next((c for c, n in norm_map.items() if n in ("amount",)), None)
    cost_col = next((c for c, n in norm_map.items() if n == "cost"), None)

    if all([item_group_col, qty_col, amount_col, cost_col]):
        dept_breakdown = (
            df_items_remaining.groupby([item_group_col], dropna=False)[[qty_col, amount_col, cost_col]]
            .sum()
            .reset_index()
        )
        dept_breakdown = dept_breakdown.sort_values(by=amount_col, ascending=False, kind="stable")
        totals_row = {
            item_group_col: "Grand Total",
            qty_col: dept_breakdown[qty_col].sum(),
            amount_col: dept_breakdown[amount_col].sum(),
            cost_col: dept_breakdown[cost_col].sum(),
        }
        dept_breakdown = pd.concat([pd.DataFrame([totals_row]), dept_breakdown], ignore_index=True)
        dept_breakdown = dept_breakdown.rename(
            columns={
                item_group_col: "Dept Breakdown",
                qty_col: "Sum of Qty",
                amount_col: "Sum of Amount",
                cost_col: "Sum of Cost",
            }
        )

        # If sales file is missing → DO NOT compute/merge sales-based columns/percent
        if sales_available:
            # keep consistent columns (blank until later enhancement fills them)
            for col in ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value", "Wastage/Sales %"]:
                if col not in dept_breakdown.columns:
                    dept_breakdown[col] = pd.NA

            desired = [
                "Dept Breakdown",
                "Sum of Qty",
                "Sum of Amount",
                "Sum of Cost",
                "Sum of Sales Qty",
                "Sum of Sales Amt.",
                "Sum of Cost Value",
                "Wastage/Sales %",
            ]
            other_cols = [c for c in dept_breakdown.columns if c not in desired]
            dept_breakdown = dept_breakdown[[c for c in desired if c in dept_breakdown.columns] + other_cols]
        else:
            # wastage-only output (no sales columns)
            dept_breakdown = dept_breakdown[
                [c for c in ["Dept Breakdown", "Sum of Qty", "Sum of Amount", "Sum of Cost"] if c in dept_breakdown.columns]
            ]
    else:
        dept_breakdown = pd.DataFrame()

    # -----------------------------
    # Top wasted items
    # -----------------------------
    norm_map2 = {col: str(col).strip().lower() for col in df_items_remaining.columns}
    description_col2 = next((c for c, n in norm_map2.items() if "description" in n), None)
    barcode_col2 = next(
        (
            c for c, n in norm_map2.items()
            if "barcode" in n or n.strip().lower() in {"ean", "ean code"}
        ),
        None,
    )

    if all([description_col2, qty_col, amount_col, cost_col]) and not df_items_remaining.empty:
        agg_spec = {qty_col: "sum", amount_col: "sum", cost_col: "sum"}
        if barcode_col2:
            agg_spec[barcode_col2] = "first"

        top_items = (
            df_items_remaining.groupby([description_col2], dropna=False)
            .agg(agg_spec)
            .reset_index()
            .sort_values(by=amount_col, ascending=False, kind="stable")
        )

        top_total = {
            description_col2: "Grand Total",
            qty_col: top_items[qty_col].sum(),
            amount_col: top_items[amount_col].sum(),
            cost_col: top_items[cost_col].sum(),
        }
        if barcode_col2:
            top_total[barcode_col2] = ""

        top_items = pd.concat([pd.DataFrame([top_total]), top_items], ignore_index=True)

        rename_map = {
            description_col2: "Top wasted items",
            qty_col: "Sum of Qty",
            amount_col: "Sum of Amount",
            cost_col: "Sum of Cost",
        }
        if barcode_col2:
            rename_map[barcode_col2] = "Barcode"

        top_items = top_items.rename(columns=rename_map)

        if "Barcode" in top_items.columns:
            desired_order = ["Top wasted items", "Barcode", "Sum of Qty", "Sum of Amount", "Sum of Cost"]
            existing_order = [c for c in desired_order if c in top_items.columns]
            remaining_cols = [c for c in top_items.columns if c not in existing_order]
            top_items = top_items[existing_order + remaining_cols]
            normalize_barcode_inplace(top_items, "Barcode")

        # Add Product Code to Top wasted items by matching Description from items
        try:
            items_cols_norm_local = {col: str(col).strip().lower() for col in df_items_remaining.columns}
            product_code_col_local = next((c for c, n in items_cols_norm_local.items() if n == "product code"), None)
            description_col_local = next((c for c, n in items_cols_norm_local.items() if "description" in n), None)
            if product_code_col_local and description_col_local:
                map_df = df_items_remaining[[description_col_local, product_code_col_local]].dropna(
                    subset=[description_col_local]
                ).copy()
                map_df.rename(
                    columns={description_col_local: "Description", product_code_col_local: "Product Code"},
                    inplace=True,
                )
                map_df["__desc_key"] = map_df["Description"].astype(str).str.strip().str.lower()
                map_df = map_df.drop_duplicates(subset=["__desc_key"])

                ti_no_total_pc = top_items[top_items["Top wasted items"] != "Grand Total"].copy()
                ti_no_total_pc["__desc_key"] = ti_no_total_pc["Top wasted items"].astype(str).str.strip().str.lower()
                ti_no_total_pc = ti_no_total_pc.merge(map_df[["__desc_key", "Product Code"]], on="__desc_key", how="left")
                ti_no_total_pc.drop(columns=["__desc_key"], inplace=True)

                total_row_keep = top_items.iloc[[0]] if not top_items.empty else pd.DataFrame()

                base_cols = ["Top wasted items", "Product Code"]
                if "Barcode" in ti_no_total_pc.columns:
                    base_cols.append("Barcode")
                desired_cols = base_cols + ["Sum of Qty", "Sum of Amount", "Sum of Cost"]
                other_cols = [c for c in ti_no_total_pc.columns if c not in desired_cols]
                ti_no_total_pc = ti_no_total_pc[[c for c in desired_cols if c in ti_no_total_pc.columns] + other_cols]
                top_items = pd.concat([total_row_keep, ti_no_total_pc], ignore_index=True)
        except Exception:
            pass

        # If sales missing → do NOT add sales columns/percent
        if not sales_available:
            cols_to_drop = ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value", "Wastage/Sales %"]
            top_items = top_items.drop(columns=[c for c in cols_to_drop if c in top_items.columns], errors="ignore")
    else:
        top_items = pd.DataFrame()

    # -----------------------------
    # RTC.xlsx (OPTIONAL)
    # -----------------------------
    rtc_items_df = None
    rtc_admin_df = None
    rtc_summary_df = pd.DataFrame()

    if rtc_available:
        try:
            rtc_excel = pd.ExcelFile(rtc_file)
            rtc_sheet_name = (
                pick_sheet(rtc_excel, args.rtc_sheet, fallback_contains=None)
                if args.rtc_sheet
                else rtc_excel.sheet_names[0]
            )

            raw_rtc = pd.read_excel(
                rtc_file,
                sheet_name=rtc_sheet_name,
                header=None,
            )

            empty_rtc = explicit_no_records(raw_rtc, rtc_sheet_name, "rtc")

            # -------------------------------------------------
            # ROBUST RTC HEADER DETECTION
            #
            # Current CRM RTC export header example:
            #   Trans Id - Till Name (Code)
            #   User Name (ID)
            #   EAN
            #   Sale Description
            #   Scanned Date
            #   Qty
            #   Retail
            #   Changed Retail
            #   Retail Diff.
            #
            # Do not rely on one exact heading. Find a row that
            # contains the main RTC fields.
            # -------------------------------------------------
            rtc_header_idx = None

            for idx, row in raw_rtc.iterrows():
                vals = [
                    re.sub(r"\s+", " ", str(v)).strip().lower()
                    for v in row.tolist()
                    if not pd.isna(v)
                ]

                has_user = any("user name" in v for v in vals)
                has_description = any("sale description" in v for v in vals)
                has_qty = any(v == "qty" or v == "quantity" for v in vals)
                has_retail = any(v == "retail" for v in vals)

                if has_user and has_description and has_qty and has_retail:
                    rtc_header_idx = idx
                    break

            if rtc_header_idx is None and not empty_rtc:
                raise ValueError(
                    "RTC header row could not be identified. "
                    "Expected User Name, Sale Description, Qty and Retail."
                )

            if empty_rtc:
                raw_rtc_df = pd.DataFrame(columns=[
                    "User Name (ID)", "Barcode", "Sale Description", "Qty",
                    "Retail", "Changed Retail", "Retail Diff.",
                ])
            else:
                raw_rtc_df = pd.read_excel(rtc_file, sheet_name=rtc_sheet_name, header=rtc_header_idx)

            raw_rtc_df.columns = [
                re.sub(r"\s+", " ", str(c)).strip()
                for c in raw_rtc_df.columns
            ]

            # -------------------------------------------------
            # STANDARDISE RTC COLUMN NAMES
            # Current file uses EAN; downstream code expects Barcode.
            # -------------------------------------------------
            rtc_rename = {}

            for col in raw_rtc_df.columns:
                norm = re.sub(
                    r"[\s_\-\.]+",
                    "",
                    str(col).strip().lower(),
                )

                if norm in {
                    "ean",
                    "eancode",
                    "barcode",
                    "barcodeno",
                    "barcodenumber",
                }:
                    rtc_rename[col] = "Barcode"

                elif norm in {
                    "saledescription",
                    "description",
                }:
                    rtc_rename[col] = "Sale Description"

                elif norm in {
                    "usernameid",
                    "username",
                    "userid",
                }:
                    rtc_rename[col] = "User Name (ID)"

                elif norm in {"qty", "quantity"}:
                    rtc_rename[col] = "Qty"

                elif norm == "retail":
                    rtc_rename[col] = "Retail"

                elif norm in {
                    "changedretail",
                    "newretail",
                }:
                    rtc_rename[col] = "Changed Retail"

                elif norm in {
                    "retaildiff",
                    "retaildifference",
                }:
                    rtc_rename[col] = "Retail Diff."

            raw_rtc_df.rename(columns=rtc_rename, inplace=True)

            if rtc_header_idx is not None:
                print(f"✅ RTC header detected on Excel row {rtc_header_idx + 1}")
            print("✅ RTC columns detected:")
            print(
                "   "
                + " | ".join(str(c) for c in raw_rtc_df.columns)
            )

            required_rtc_columns = [
                "User Name (ID)",
                "Barcode",
                "Sale Description",
                "Qty",
                "Retail",
                "Changed Retail",
                "Retail Diff.",
            ]

            missing_rtc_columns = [
                c
                for c in required_rtc_columns
                if c not in raw_rtc_df.columns
            ]

            if missing_rtc_columns:
                raise ValueError(
                    "Required RTC column(s) missing: "
                    + ", ".join(missing_rtc_columns)
                    + ". Available columns: "
                    + ", ".join(
                        str(c) for c in raw_rtc_df.columns
                    )
                )

            working_df = raw_rtc_df.copy()

            # Remove report grouping/subtotal rows.
            working_df = working_df[
                working_df["Sale Description"].notna()
            ].copy()

            working_df["Sale Description"] = (
                working_df["Sale Description"]
                .astype(str)
                .str.strip()
            )

            working_df = working_df[
                working_df["Sale Description"] != ""
            ].copy()

            # Clean Barcode/EAN as a text key.
            working_df["Barcode"] = (
                working_df["Barcode"]
                .astype(str)
                .str.strip()
                .str.replace(r"\.0+$", "", regex=True)
                .replace({"nan": "", "None": ""})
            )

            # RTC numeric columns can arrive as object because the
            # source report contains group headings and total rows.
            for numeric_col in [
                "Qty",
                "Retail",
                "Changed Retail",
                "Retail Diff.",
            ]:
                working_df[numeric_col] = pd.to_numeric(
                    working_df[numeric_col],
                    errors="coerce",
                )

            # Drop rows that have no usable numeric RTC values.
            working_df = working_df.dropna(
                subset=[
                    "Qty",
                    "Retail",
                    "Changed Retail",
                    "Retail Diff.",
                ],
                how="all",
            )

            # Split admin/bala activity from normal staff activity.
            user_text = (
                working_df["User Name (ID)"]
                .fillna("")
                .astype(str)
                .str.strip()
                .str.lower()
            )

            mask_admin = user_text.str.startswith(
                ("admin", "bala")
            )

            rtc_admin_df = working_df[mask_admin].copy()
            rtc_items_df = working_df[~mask_admin].copy()

            print(
                f"✅ RTC rows loaded: {len(working_df)} "
                f"(staff={len(rtc_items_df)}, "
                f"admin/bala={len(rtc_admin_df)})"
            )

            # -------------------------------------------------
            # RTC SUMMARY
            # -------------------------------------------------
            if rtc_items_df is not None and not rtc_items_df.empty:
                rtc_summary_df = (
                    rtc_items_df
                    .groupby(
                        ["Sale Description", "Barcode"],
                        dropna=False,
                    )[
                        [
                            "Qty",
                            "Retail",
                            "Changed Retail",
                            "Retail Diff.",
                        ]
                    ]
                    .sum(min_count=1)
                    .reset_index()
                )

                rtc_summary_df = rtc_summary_df.sort_values(
                    "Retail Diff.",
                    ascending=True,
                    kind="stable",
                )

                totals_row = {
                    "Sale Description": "Grand Total",
                    "Barcode": "",
                }

                for c in [
                    "Qty",
                    "Retail",
                    "Changed Retail",
                    "Retail Diff.",
                ]:
                    totals_row[c] = rtc_summary_df[c].sum()

                rtc_summary_df = pd.concat(
                    [
                        pd.DataFrame([totals_row]),
                        rtc_summary_df,
                    ],
                    ignore_index=True,
                )

                print(
                    f"✅ RTC summary created: "
                    f"{len(rtc_summary_df) - 1} item rows"
                )
            else:
                rtc_summary_df = pd.DataFrame([{
                    "Sale Description": "Grand Total", "Barcode": "", "Qty": 0,
                    "Retail": 0, "Changed Retail": 0, "Retail Diff.": 0,
                }])

        except Exception as exc:
            raise ValueError(f"Could not process RTC export {rtc_file}") from exc

    # -----------------------------
    # Sales.xlsx (OPTIONAL)
    # -----------------------------
    sales_df = None
    sales_summary_df = pd.DataFrame()

    if sales_available:
        try:
            sales_excel = pd.ExcelFile(sales_file)
            sales_sheet_name = (
                pick_sheet(sales_excel, args.sales_sheet, fallback_contains=None)
                if args.sales_sheet
                else sales_excel.sheet_names[0]
            )
            raw_sales = pd.read_excel(sales_file, sheet_name=sales_sheet_name, header=None)
            sales_header_idx = next(
                (
                    idx
                    for idx, row in raw_sales.iterrows()
                    if row.astype(str).str.contains("Description", case=False).any()
                ),
                None,
            )
            if sales_header_idx is not None:
                sales_df = pd.read_excel(sales_file, sheet_name=sales_sheet_name, header=sales_header_idx)
                sales_df = sales_df.dropna(axis=1, how="all")
                desc_col = next((c for c in sales_df.columns if "description" in str(c).lower()), None)
                if desc_col:
                    sales_df = sales_df[
                        sales_df[desc_col].notna() & (sales_df[desc_col].astype(str).str.strip() != "")
                    ]
                # Convert Item Code properly
                item_code_col = next((c for c in sales_df.columns if "item code" in str(c).lower()), None)
                if item_code_col:
                    series = sales_df[item_code_col].astype(str).str.strip()
                    is_digits = series.str.match(r"^\d+$")
                    series_numeric = pd.to_numeric(series.where(is_digits), errors="coerce")
                    series.loc[is_digits] = series_numeric.loc[is_digits]
                    sales_df[item_code_col] = series

            # Sales Summary
            if sales_df is not None and not sales_df.empty:
                sales_df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in sales_df.columns]

                def find_col(substring):
                    substring = substring.lower()
                    for col in sales_df.columns:
                        if substring in col.lower():
                            return col
                    return None

                item_code_col = find_col("item code")
                sales_qty_col = find_col("sales qty")
                sales_amt_col = find_col("sales amt")
                cost_value_col = find_col("cost value")

                if all([item_code_col, sales_qty_col, sales_amt_col, cost_value_col]):
                    sales_summary_df = (
                        sales_df.groupby([item_code_col], dropna=False)
                        .agg({sales_qty_col: "sum", sales_amt_col: "sum", cost_value_col: "sum"})
                        .reset_index()
                    )
                    sales_summary_df = sales_summary_df.rename(
                        columns={
                            item_code_col: "Item Code",
                            sales_qty_col: "Sum of Sales Qty",
                            sales_amt_col: "Sum of Sales Amt.",
                            cost_value_col: "Sum of Cost Value",
                        }
                    )
                    totals_row = {
                        "Item Code": "Grand Total",
                        "Sum of Sales Qty": sales_summary_df["Sum of Sales Qty"].sum(),
                        "Sum of Sales Amt.": sales_summary_df["Sum of Sales Amt."].sum(),
                        "Sum of Cost Value": sales_summary_df["Sum of Cost Value"].sum(),
                    }
                    sales_summary_df = pd.concat([pd.DataFrame([totals_row]), sales_summary_df], ignore_index=True)

        except Exception:
            sales_df = None
            sales_summary_df = pd.DataFrame()

    # -----------------------------
    # Wastage vs Sales merge (Sales OPTIONAL)
    # -----------------------------
    if not df_items_remaining.empty:
        df_items_remaining.columns = [str(c).strip() for c in df_items_remaining.columns]

        item_code_col = next((c for c in df_items_remaining.columns if str(c).strip().lower() == "product code"), None)
        qty_col2 = next((c for c, n in norm_map.items() if n in ("qty", "quantity")), None)
        cost_col2 = next((c for c, n in norm_map.items() if n == "cost"), None)
        amount_col2 = next((c for c, n in norm_map.items() if n == "amount"), None)
        barcode_col3 = next(
            (
                c for c in df_items_remaining.columns
                if re.sub(r"[\s_\-]+", "", str(c).strip().lower())
                in {"barcode", "ean", "eancode"}
            ),
            None,
        )
        description_col3 = next(
            (c for c in df_items_remaining.columns if "description" in str(c).strip().lower()), None
        )
        item_group_col3 = next((c for c in df_items_remaining.columns if str(c).strip().lower() == "item group"), None)

        # Validate the columns required for Wastage calculations.
        required_wastage_columns = {
            "Product Code": item_code_col,
            "Qty": qty_col2,
            "Cost": cost_col2,
            "Amount": amount_col2,
        }

        missing_required = [
            label
            for label, col_name in required_wastage_columns.items()
            if col_name is None
        ]

        if missing_required:
            raise ValueError(
                "Required Wastage column(s) not found: "
                + ", ".join(missing_required)
                + ". Available columns: "
                + ", ".join(str(c) for c in df_items_remaining.columns)
            )

        # Build the aggregation dictionary ONLY from columns that exist.
        # This prevents pandas from receiving a {None: ...} entry.
        agg_spec = {
            qty_col2: "sum",
            cost_col2: "sum",
            amount_col2: "sum",
        }

        if barcode_col3 is not None:
            agg_spec[barcode_col3] = "first"

        if description_col3 is not None:
            agg_spec[description_col3] = "first"

        if item_group_col3 is not None:
            agg_spec[item_group_col3] = "first"

        grouped = (
            df_items_remaining.groupby(item_code_col, dropna=False)
            .agg(agg_spec)
            .reset_index()
        )

        rename_grouped_columns = {
            item_code_col: "Product Code",
            qty_col2: "Wastage Qty",
            cost_col2: "Wastage Cost",
            amount_col2: "Wastage Amount",
        }

        if barcode_col3 is not None:
            rename_grouped_columns[barcode_col3] = "Barcode"

        if description_col3 is not None:
            rename_grouped_columns[description_col3] = "Description"

        if item_group_col3 is not None:
            rename_grouped_columns[item_group_col3] = "Item Group"

        grouped = grouped.rename(columns=rename_grouped_columns)

        # Keep a predictable output structure even if an optional source
        # column is absent in a future CRM export.
        if "Barcode" not in grouped.columns:
            grouped["Barcode"] = ""

        if "Description" not in grouped.columns:
            grouped["Description"] = ""

        if "Item Group" not in grouped.columns:
            grouped["Item Group"] = ""

        totals_row = {
            "Product Code": "Grand Total",
            "Barcode": "",
            "Description": "",
            "Item Group": "",
            "Wastage Qty": grouped["Wastage Qty"].sum(),
            "Wastage Cost": grouped["Wastage Cost"].sum(),
            "Wastage Amount": grouped["Wastage Amount"].sum(),
        }
        wastage_vs_sales_df = pd.concat([pd.DataFrame([totals_row]), grouped], ignore_index=True)

        # Fix Product Code as string/int
        is_digits = wastage_vs_sales_df["Product Code"].astype(str).str.match(r"^\d+$")
        wastage_vs_sales_df.loc[is_digits, "Product Code"] = pd.to_numeric(
            wastage_vs_sales_df.loc[is_digits, "Product Code"], errors="coerce"
        ).astype("Int64")
        wastage_vs_sales_df["Product Code"] = wastage_vs_sales_df["Product Code"].astype(object)

        if "Barcode" in wastage_vs_sales_df.columns:
            normalize_barcode_inplace(wastage_vs_sales_df, "Barcode")

        # Merge sales summary ONLY if sales exists
        if sales_available and not sales_summary_df.empty:
            sales_summary_clean = sales_summary_df[sales_summary_df["Item Code"] != "Grand Total"]
            merged_df = wastage_vs_sales_df.merge(
                sales_summary_clean[["Item Code", "Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]],
                left_on="Product Code",
                right_on="Item Code",
                how="left",
            )
            merged_df.drop(columns=["Item Code"], inplace=True)

            base_cols = ["Product Code", "Barcode", "Description", "Item Group", "Wastage Qty", "Wastage Cost", "Wastage Amount"]
            sales_cols = ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]
            merged_df = merged_df[base_cols + sales_cols]
            wastage_vs_sales_df = merged_df
        else:
            # wastage-only (no sales columns, no percent)
            wastage_vs_sales_df = wastage_vs_sales_df[
                ["Product Code", "Barcode", "Description", "Item Group", "Wastage Qty", "Wastage Cost", "Wastage Amount"]
            ]
    else:
        # if no items, still create a wastage-only sheet structure
        wastage_vs_sales_df = pd.DataFrame(
            columns=[
                "Product Code",
                "Barcode",
                "Description",
                "Item Group",
                "Wastage Qty",
                "Wastage Cost",
                "Wastage Amount",
            ]
        )

    # -----------------------------
    # Write Wastage vs Sales sheet
    # - If Sales missing: NO sales columns, NO percent, just wastage-only output
    # -----------------------------
    if wastage_vs_sales_df.empty:
        print("❌ Wastage vs Sales dataframe is empty. Nothing to write.")
    else:
        # Remove any existing Grand Total (rebuild cleanly)
        if "Product Code" in wastage_vs_sales_df.columns:
            wastage_vs_sales_df = wastage_vs_sales_df[wastage_vs_sales_df["Product Code"] != "Grand Total"]

        # Add Grand Total row (wastage always)
        total_row = {
            "Product Code": "Grand Total",
            "Barcode": "",
            "Description": "",
            "Item Group": "",
            "Wastage Qty": wastage_vs_sales_df.get("Wastage Qty", pd.Series(dtype=float)).sum(),
            "Wastage Cost": wastage_vs_sales_df.get("Wastage Cost", pd.Series(dtype=float)).sum(),
            "Wastage Amount": wastage_vs_sales_df.get("Wastage Amount", pd.Series(dtype=float)).sum(),
        }

        # If sales exists, include sales totals and percent
        if sales_available and all(
            c in wastage_vs_sales_df.columns for c in ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]
        ):
            total_row.update(
                {
                    "Sum of Sales Qty": wastage_vs_sales_df["Sum of Sales Qty"].sum(),
                    "Sum of Sales Amt.": wastage_vs_sales_df["Sum of Sales Amt."].sum(),
                    "Sum of Cost Value": wastage_vs_sales_df["Sum of Cost Value"].sum(),
                }
            )

        wastage_vs_sales_df = pd.concat([pd.DataFrame([total_row]), wastage_vs_sales_df], ignore_index=True)

        # Percent ONLY if sales exists
        if sales_available and "Sum of Sales Qty" in wastage_vs_sales_df.columns:
            def calc_wastage_percent(row):
                if pd.isna(row["Sum of Sales Qty"]) or row["Sum of Sales Qty"] == 0:
                    return "No Sales"
                return row["Wastage Qty"] / row["Sum of Sales Qty"]

            wastage_vs_sales_df["Wastage/Sales %"] = wastage_vs_sales_df.apply(calc_wastage_percent, axis=1)

        # Write to Excel
        with pd.ExcelWriter(wastage_file, engine="openpyxl", mode="a", if_sheet_exists="replace") as writer:
            wastage_vs_sales_df.to_excel(writer, sheet_name="Wastage vs Sales", index=False)

        # Apply "No Sales" formatting ONLY if sales exists and percent exists
        if sales_available and "Wastage/Sales %" in wastage_vs_sales_df.columns:
            wb = load_workbook(wastage_file)
            ws = wb["Wastage vs Sales"]

            red_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
            red_font = Font(color="9C0006", bold=True)

            percent_col_idx = None
            sales_qty_col_idx = None
            for idx, cell in enumerate(ws[1], 1):
                if cell.value == "Wastage/Sales %":
                    percent_col_idx = idx
                if cell.value == "Sum of Sales Qty":
                    sales_qty_col_idx = idx

            if percent_col_idx and sales_qty_col_idx:
                percent_col = get_column_letter(percent_col_idx)
                sales_qty_col = get_column_letter(sales_qty_col_idx)

                for row in range(2, ws.max_row + 1):
                    sales_qty_cell = ws[f"{sales_qty_col}{row}"]
                    percent_cell = ws[f"{percent_col}{row}"]

                    try:
                        sales_qty = float(sales_qty_cell.value)
                    except (ValueError, TypeError):
                        sales_qty = 0

                    if sales_qty == 0 or percent_cell.value == "No Sales":
                        percent_cell.value = "No Sales"
                        percent_cell.fill = red_fill
                        percent_cell.font = red_font
                    else:
                        try:
                            val = float(percent_cell.value)
                            percent_cell.value = val
                            percent_cell.number_format = "0.00%"
                            percent_cell.fill = PatternFill()  # clear
                            percent_cell.font = Font()  # clear
                        except (ValueError, TypeError):
                            pass

            wb.save(wastage_file)
            print("✅ Wastage vs Sales updated with Grand Total and 'No Sales' formatting.")
        else:
            print("✅ Wastage vs Sales updated with Grand Total (wastage-only; sales missing or skipped).")

    # -----------------------------
    # Summary Items (group by Product Code)
    # -----------------------------
    summary_items_df = pd.DataFrame()
    if not df_items_remaining.empty:
        if {"Product Code", "Description", "Item Group"}.issubset(df_items_remaining.columns):
            summary_items_df = df_items_remaining.groupby(
                ["Product Code", "Description", "Item Group"], as_index=False
            ).sum(numeric_only=True)

            # Merge Sales + compute % ONLY if sales exists
            if sales_available and not sales_summary_df.empty:
                ss_clean = sales_summary_df[sales_summary_df["Item Code"] != "Grand Total"][
                    ["Item Code", "Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]
                ].copy()
                ss_clean["Item Code Key"] = normalize_code_key(ss_clean["Item Code"])
                summary_items_df["Product Code Key"] = normalize_code_key(summary_items_df["Product Code"])

                summary_items_df = summary_items_df.merge(
                    ss_clean.drop(columns=["Item Code"]).rename(columns={"Item Code Key": "Product Code Key"}),
                    on="Product Code Key",
                    how="left",
                )
                summary_items_df.drop(columns=["Product Code Key"], inplace=True, errors="ignore")

                qty_col_summary = next(
                    (c for c in summary_items_df.columns if str(c).strip().lower() in ("qty", "quantity")), None
                )
                if qty_col_summary:
                    def calc_pct_sum_row(row):
                        try:
                            s_qty = float(row.get("Sum of Sales Qty", 0))
                        except (TypeError, ValueError):
                            s_qty = 0
                        try:
                            w_qty = float(row.get(qty_col_summary, 0))
                        except (TypeError, ValueError):
                            w_qty = 0
                        if s_qty == 0:
                            return "No Sales"
                        return w_qty / s_qty

                    summary_items_df["Wastage/Sales %"] = summary_items_df.apply(calc_pct_sum_row, axis=1)

            # Grand Total
            totals_row = {"Product Code": "Grand Total", "Description": "", "Item Group": ""}
            for c in summary_items_df.select_dtypes(include="number").columns:
                totals_row[c] = summary_items_df[c].sum()

            if sales_available and totals_row.get("Sum of Sales Qty", 0) and totals_row["Sum of Sales Qty"] != 0:
                qty_col_summary = next(
                    (c for c in summary_items_df.columns if str(c).strip().lower() in ("qty", "quantity")), None
                )
                if qty_col_summary:
                    totals_row["Wastage/Sales %"] = totals_row[qty_col_summary] / totals_row["Sum of Sales Qty"]
            elif sales_available:
                totals_row["Wastage/Sales %"] = "No Sales"

            summary_items_df = pd.concat([pd.DataFrame([totals_row]), summary_items_df], ignore_index=True)

            print("✅ Summary Items sheet created with grouping and Grand Total.")

    # -----------------------------
    # Split Summary Items into categories (these are still written; sales columns only exist if sales file exists)
    # -----------------------------
    if not summary_items_df.empty:

        deli_groups = {"SMOKE MEAT","SAUSAGE(DELI COUNTER)","FOOD TO GO","HAM","FRESH MEAT","OTHER", "SALADS","FISH","FISH-RYBY","READYMEAL","CHEESE","DELI COUNTER-AGA","DELI", "DELI COUNTER","ROM-DELI","GARMAZERKA","ROM-DELI (DELI)","DELI  COUNTER OPEN", "HAMS (DELI)","LIT-DELI","SMOKE MEAT(DELI)","PATE -MEAT(DELI)","FISH  RYBY", "MEAT","FISH  RYBY (DELI)","OTHER MEAT PRODUCTS","ROMANIAN DELI", "SAUSAGE(DELI COUNTER-AGA)","MIESO I WEDLINY","OTHER DELI","ROM DELI", "WEDLINY","Romanco Cheese","RYBY", "ROM-MEAT", "SALAD", "DELI", "DELI Item (s)", "DELI /CHEESE", "DELI /FISH-RYBY", "DELI /LIT-DELI", "DELI /READYMEAL", "DELI /ROM-DELI", "DELI /RUS-DELI", "DELI /SALADS", "DELI /SMOKE MEAT", "FRESH MEAT", "DELI COUNTER", "DELI COUNTER Item (s)", "FOOD TO GO", "SALADS", "GARMAZERKA", "FISH", "FISH Item (s)", "FISH RYBY", "DELI COUNTER OPEN", "CHEESE", "HAM", "OTHER", "SAUSAGE(DELI COUNTER)", "DELI COUNTER PERIVALE", "DELI COUNTER-AGA", "SMOKE MEAT(DELI)", "SMOKE MEAT(DELI) Item (s)", "PATE -MEAT(DELI)", "HAMS (DELI)", "READYMEAL (DELI)", "ROM-DELI (DELI)", "DELI", "FRESH MEAT", "DELI COUNTER", "SMOKE MEAT(DELI)", "ROM DELI",
        "DELI -  SMOKE MEAT", "ROM-MEAT", "DELI -  ROM-DELI",
        "DELI - READYMEAL", "ROM-CHEESE", "HAMS (DELI)",
        "DELI -  FISH-RYBY", "HAM", "SAUSAGE(DELI COUNTER)", "CHEESE",
        "FISH  RYBY (DELI)", "OTHER MEAT PRODUCTS", "MEAT", "GARMAZERKA",
        "ROMANIAN DELI", "SAUSAGE(DELI COUNTER-AGA)","OTHER DELI","SALADS (DAIRY)",
        "DELI /ACM", "DELI /CHEESE", "DELI /FISH-RYBY","DELI/ ACM",
        "DELI /POLSKA WEDZARNIA", "DELI /READYMEAL", "DELI /ROM-DELI","FISH",
        "DELI /SMOKE MEAT","DAIRY /PATE","ROM-DELI (DELI)", "DELI / POLSKA WEDZARNIA"
}

        dairy_groups = {"ROM-CHEESE","PACK MEAT","ROM-DAIRY","DAIRY PRODUCTS","DAIRY", "SAUCES(DA)","READY-MEAL","CHILLED MEAT PRODUCTS","SOKOLOW/POLISH MEAT", "BULG-DAIRY","PATE","ROMANIAN DAIRY","PKD CHEESE","MARGARINE", "CHILLED FISH PRODUCTS","CURD","YOGHURT","DAIRY NABIAL","OTHER MEAT PRODUCTS", "READY MADE MEALS","YOG-DESERT","YEAST","BUTTER","SALAD","MILK-KEFIR", "CREAM","FISH(RYBY)","LARD","BUTTER & MARGARINE","CREAM & BUTTERMILK & KEFI", "JELLY MEAT","LIT-DAIRY","DESSERTS","MILK","FOOD TO GO","DANIA SWIEZE", "PACKED CHEESE (DAIRY)","PRZETWORY MLECZARSKIE","CEDROB", "FRESH MILK (DAIRY)","FISH  RYBY","SALADS (DAIRY)","ROM DAIRY","JAJA", "FISH-RYBY", "PACK MEAT OTHER", "DAIRY", "DAIRY Item (s)",  "DAIRY /BULG-DAIRY", "DAIRY /BUTTER", "DAIRY /CREAM", "DAIRY /CURD", "DAIRY /FISH(RYBY)", "DAIRY /JELLY MEAT", "DAIRY /LARD", "DAIRY /LIT-DAIRY", "DAIRY /MARGARINE", "DAIRY /MILK-KEFIR", "DAIRY /PACK MEAT", "DAIRY /PATE", "DAIRY /PKD CHEESE", "DAIRY /READY-MEAL", "DAIRY /ROM-CHEESE", "DAIRY /ROM-DAIRY", "DAIRY /ROM-MEAT", "DAIRY /SALAD", "DAIRY /SAUCES", "DAIRY /YEAST", "DAIRY /YOG-DESERT", "DAIRY PRODUCTS", "DAIRY PRODUCTS Item (s)", "CHILLED MEAT PRODUCTS", "BUTTER & MARGARINE", "READY MADE MEALS", "CHILLED FISH PRODUCTS", "DESSERTS", "MILK", "CREAM & BUTTERMILK & KEFI", "YOGHURT", "DAIRY NABIAL", "ROMANIAN DAIRY", "DAIRY", "DAIRY PRODUCTS", "CHILLED MEAT PRODUCTS", "ROM DAIRY",
        "READY MADE MEALS", "CHILLED FISH PRODUCTS", "DANIA SWIEZE",
        "FISH  RYBY", "KUCHNIA W PROSZKU", "MASTERMEDIA",
        "PRZETWORY MLECZARSKIE", "RYBY", "YOGHURT", "ROMANIAN DAIRY",
        "PACK MEAT", "PKD CHEESE", "YOG-DESERT", "READY-MEAL",
        "ROM-DAIRY", "OTHER MEAT PRODUCTS", "SALADS",
        "CREAM & BUTTERMILK & KEFI", "FOOD TO GO", "PACKED CHEESE (DAIRY)",
        "DESSERTS", "SOKOLOW/POLISH MEAT", "FRESH MILK (DAIRY)",
        "BUTTER & MARGARINE", "CEDROB","MILK",
        "DAIRY /BUTTER", "DAIRY /CREAM", "DAIRY /CURD",
        "DAIRY /FISH(RYBY)", "DAIRY /JELLY MEAT", "DAIRY /LARD",
        "DAIRY /LIT-DAIRY", "DAIRY /MARGARINE", "DAIRY /MILK-KEFIR",
        "DAIRY /PACK MEAT", "DAIRY /PKD CHEESE", "DAIRY /READY-MEAL",
        "DAIRY /ROM-CHEESE", "DAIRY /ROM-DAIRY", "DAIRY /ROM-MEAT",
        "DAIRY /SALAD", "DAIRY /SAUCES", "DAIRY /YOG-DESERT", "DAIRY NABIAL", "DAIRY /BULG-DAIRY", 	"DAIRY/CAMARA","DAIRY/CRIS-TIM", "DAIRY/MARCEL", "DAIRY/TUDIA WEIGHT", "DELI/ACM",
	"DELI/POLSKA WEDZARNIA", "DELI/RAFA","SALADS (DAIRY)","MILK"
}

        fruitveg_groups = {"VEG-FRUIT","VEGETABLES","POL-VEG","FRUITS","POL-FRUITS","PICKLE-VEG", "DRY VEG","KISZONKI","VEGETABLES WARZYWA","FRESH FRUIT & VEG", "OWOCE I WARZYWA SWIEZE","FRESH NUTS & SEEDS","fruits","WARZYWA I OWOCE", "VEG-FRUIT", "VEG-FRUIT Item (s)", "VEG-FRUIT /FRUITS", "VEG-FRUIT /PICKLE-VEG", "VEG-FRUIT /POL-FRUITS", "VEG-FRUIT /POL-VEG", "VEG-FRUIT /VEGETABLES", "VEG-FRUIT /DRY VEG",  "FRESH FRUIT & VEG", "FRUITS & VEGETABLES", "VEG-FRUIT",
        "VEGETABLES WARZYWA", "FRUITS", "KISZONKI",
        "OWOCE I WARZYWA SWIEZE", "VEG-FRUIT /DRY VEG",
        "VEG-FRUIT /FRUITS", "VEG-FRUIT /PICKLE-VEG",
        "VEG-FRUIT /POL-FRUITS", "VEG-FRUIT /POL-VEG",
        "VEG-FRUIT /VEGETABLES"
}

        bakery_groups = {"BAKERY", "BREAD", "CAKES", "DRY BREAD", "LL BREAD", "PASTRIES", "ROLLS", "READYMEALS", "ROM-BREAD", "PACZKI/DOUGHNUTS", "BREADS & CAKES", "DOUGHNUT", "Bakery Ambrosia", "BAKERY BLUEBAKERY", "BAKERY NATURA BAKERY", "BAKERY STARY MLYN", "Polish Bakery", "Pollish Village Bread", "TWELVE GRAINS", "PACZEK/DOUGHNUT", "DROZDZOWKA/PASTRY", "CAKES SPIZARNIA", "CHRISTMAS CAKES PVB", "CIASTA I PIECZYWO", "DOUGHNUTS/PACZKI", "BAKERY AMBASSADOR","Bakery Ambrosia", "BAKERY BLUEBAKERY", "BAKERY NATURA BAKERY", "BAKERY STARY MLYN", "BAKERY",  "BAKERY Item (s)", "BAKERY /BREAD" , "BAKERY /CAKES", "BAKERY /DRY BREAD", "BAKERY /LL BREAD", "BAKERY /PASTRIES", "BAKERY /READYMEALS", "BAKERY /ROLLS", "BAKERY /ROM-BREAD", "BAKERY /PACZKI/DOUGHNUTS", "BREADS & CAKES", "BREADS & CAKES Item (s)", "BAKERY", "DOUGHNUT", "Bakery Ambrosia", "BAKERY BLUEBAKERY", "BAKERY NATURA BAKERY", "BAKERY STARY MLYN", "Polish Bakery", "Pollish Village Bread", "TWELVE GRAINS", "PACZEK/DOUGHNUT", "DROZDZOWKA/PASTRY", "CAKES SPIZARNIA" ,
                          "BAKERY AMBROSIA", "BAKERY BLUEBAKERY", "BAKERY NATURA BAKERY",
        "BREAD & CAKES", "BREADS & CAKES", "POLISH BAKERY",
        "POLLISH VILLAGE BREAD", "TWELVE GRAINS", "BAKERY", "CAKES",
        "CAKES SPIZARNIA", "BREAD", "PASTRIES", "PACZKI/DOUGHNUTS",
        "CIASTA I PIECZYWO", "CHRISTMAS CAKES PVB", "BAKERY STARY MLYN",
        "BAKERY GOSIA", "BAKERY /BREAD", "BAKERY /CAKES","LL BREAD",
        "BAKERY /DRY BREAD", "BAKERY /LL BREAD","DOUGHNUTS/PACZKI",
        "BAKERY /PACZKI/DOUGHNUTS", "BAKERY /PASTRIES","LL BREAD",
	"BAKERY /ROLLS", "BAKERY /ROM-BREAD", "BAKERY /READYMEALS","LONG LIVE BREAD",
}

        grocery_groups = {"GROCERY", "ROMANIAN&RUSSIAN", "SLOVAK FOOD", "GENERAL GROCERY", "GROCERY - Reduced VAT", "GROCERY - Zero VAT", "GROCERY - Variable VAT", "ROMANIAN FOOD", "CONFECTIONERY", "TEA & COFFEE", "OIL/VINEGAR", "BABY FOOD","BAKING", "CANS/JARS", "CHEMIA I KOSMETYKI", "CONFECTIONERY", "EGGS", "GENERAL GROCERY", "JAJA", "JAMS,SPREADS ETC", "JARS-PICKLES", "JARS-SAUCES", "KETCHUP MUSTARD MAJO", "KISIEL&PUDDING&JELLY", "OIL/VINEGAR", "PASTA", "PATE", "POWDERY PRODUCTS", "PRZEKASKI", "READY MELAS", "SOUPS", "SPICES", "SYRUP", "TEA & COFFEE", "TOMATO CONCENTRATE", "WEDLINY NA WAGE", "COFFEE-TEA", "MasterMedia", "ROM-GROCER", "GENERAL GROCERY", "CONFECTION", "BULGARIAN", "CANS-JARS", "SAUCES", "BAKING", "SEASONING", "BK-SPREADS", "JARS-SAUCES", "DRY GROCER", "RICE GROAT CERALS ETC", "POWDERY PRODUCTS", "BABY FOOD", "SPICES", "CONFECTIONERY", "CANS/JAR", "KETCHUP MUSTARD MAJO", "PICKLE-VEG", "SOUPS", "KETCHUP MUSTARD MAJO", "CONFECTIONERY", "JAMS,SPREADS ETC", "SLODYCZE I PRZEKASKI", "PASTA", "READY MELAS", "CANS/JARS", "BAKING", "JARS-PICKLES", "GROCERY - Zero VAT", "SPICES", "GENERAL GROCERY", "TEA & COFFEE", "RICE GROAT CERALS ETC", "SOUPS", "BABY FOOD", "PRZETWORY MLECZARSKIE NIECH+üODNICZE", "EGGS", "PATE", "JARS-SAUCES", "POWDERY PRODUCTS", "KISIEL&PUDDING&JELLY", "KUCHNIA W PROSZKU", "GROCERY - Variable VAT", "DODATKI DO POTRAW", "FRUITS IN JAR/CAN", "GROCERY", "KUCHNIA DANIA GOTOWE", "ARTYKULY SYPKIE", "FRESH NUTS & SEEDS", "SYRUP", "BREAD CRUMBS", "OIL/VINEGAR", "NAPOJE GORACE", "ZDROWA ZYWNOSC", "Gorace Napoje", "OLEJE I OLIWY", "ORGANIC FOOD", "TLUSZCZE I OLEJE", "PRZEKASKI", "JAJA", "GENERAL GROCERY", "GENERAL GROCERY Item (s)", "ARTYKULY SYPKIE", "ARTYKULY SYPKIE Item (s)", "KUCHNIA W PROSZKU", "BABY FOOD", "PRZETWORY MLECZARSKIE NIECH+üODNICZE", "PRZETWORY MLECZARSKIE NIECH+üODNICZE Item (s)", "HORECA CHLODNIA", "EGGS", "EGGS Item (s)", "JAJA", "SOUPS", "JARS-SAUCES", "FRUITS IN JAR/CAN", "ORGANIC FOOD", "ORGANIC FOOD Item (s)", "ZDROWA ZYWNOSC", "ZDROWA ZYWNOSC CHLODNIA", "JAMS,SPREADS ETC", "PASTA", "OIL/VINEGAR", "OIL/VINEGAR Item (s)", "TLUSZCZE I OLEJE", "TLUSZCZE I OLEJE NIECHLODNICZE", "OLEJE I OLIWY", "TLUSZCZE", "KETCHUP MUSTARD MAJO", "JARS-PICKLES", "READY MELAS", "READY MELAS Item (s)", "KUCHNIA DANIA GOTOWE", "BREAD CRUMBS", "BAKING", "SPICES", "CONFECTIONERY", "CONFECTIONERY Item (s)", "DODATKI DO POTRAW", "SLODYCZE I PRZEKASKI", "PRZEKASKI", "POWDERY PRODUCTS", "SYRUP", "TEA & COFFEE", "TEA & COFFEE Item (s)", "NAPOJE GORACE", "Gorace Napoje", "RICE GROAT CERALS ETC", "PATE", "CANS/JARS", "KISIEL&PUDDING&JELLY", "GROCERY",  "GENERAL GROCERY", "GENERAL GROCERY Item (s)", "PRZETWORY MLECZARSKIE NIECHLODNICZE", "SOUPS", "JARS-SAUCES", "FRUITS IN JAR/CAN", "ORGANIC FOOD", "JAMS,SPREADS ETC", "PASTA", "OIL/VINEGAR", "OIL/VINEGAR Item (s)", "TLUSZCZE I OLEJE", "TLUSZCZE I OLEJE NIECHLODNICZE", "OLEJE I OLIWY", "TLUSZCZE", "KETCHUP MUSTARD MAJO", "JARS-PICKLES", "READY MELAS", "BREAD CRUMBS", "BAKING", "SPICES", "CONFECTIONERY", "CONFECTIONERY Item (s)", "SLODYCZE", "PRZEKASKI", "POWDERY PRODUCTS", "TOMATO CONCENTRATE", "SYRUP", "TEA & COFFEE", "TEA & COFFEE Item (s)", "NAPOJE GORACE", "HOT DRINKS", "Gorace Napoje", "RICE GROAT CERALS ETC", "PATE", "CANS/JARS", "KISIEL&PUDDING&JELLY", "BABY FOOD", "LL BREAD","GENERAL GROCERY", "GENERAL GROCERY Item (s)", "KUCHNIA DANIA GOTOWE", "BABY FOOD", "EGGS", "SOUPS", "JARS-SAUCES", "FRUITS IN JAR/CAN", "ORGANIC FOOD", "JAMS,SPREADS ETC", "PASTA", "OIL/VINEGAR", "KETCHUP MUSTARD MAJO", "JARS-PICKLES", "READY MELAS", "BREAD CRUMBS", "BAKING", "SPICES", "CONFECTIONERY", "POWDERY PRODUCTS", "TOMATO CONCENTRATE", "SYRUP", "TEA & COFFEE", "RICE GROAT CERALS ETC", "PATE", "CANS/JAR", "KISIEL&PUDDING&JELLY", "FRESH NUTS & SEEDS", "HUN-GROCER (GROCERY)", "LONG LIVE BREAD", "GROCERY ITEMS (GROCERY)", "GROCERY - Standard VAT", "GROCERY - Zero VAT", "GROCERY - Reduced VAT", "GROCERY - Variable VAT", "GROCERY", "GROCERY Item (s)", "GROCERY /BABY FOOD", "GROCERY /BAKING", "GROCERY /BIO FOOD", "GROCERY /BK-SPREADS", "GROCERY /BULGARIAN", "GROCERY /BUL-GROC", "GROCERY /CANS-JARS", "GROCERY /COFFEE-TEA", "GROCERY /CONFECTION", "GROCERY /DRY GROCER", "GROCERY /EGGS", "GROCERY /LIT-GROCER", "GROCERY /LLMILKCREM", "GROCERY /ROM-GROCER", "GROCERY /RUS-GROCER", "GROCERY /SAUCES", "GROCERY /SEASONING", "GROCERY /SPICES", "GROCERY /OIL", "GROCERY /PACK MEAT OTHER", "GENERAL GROCERY", "GENERAL GROCERY Item (s)", "KUCHNIA DANIA GOTOWE", "BABY FOOD", "EGGS", "SOUPS", "JARS-SAUCES", "FRUITS IN JAR/CAN", "ORGANIC FOOD", "JAMS,SPREADS ETC", "PASTA", "OIL/VINEGAR", "KETCHUP MUSTARD MAJO", "JARS-PICKLES", "READY MELAS", "BREAD CRUMBS", "BAKING", "SPICES", "CONFECTIONERY", "POWDERY PRODUCTS", "TOMATO CONCENTRATE", "SYRUP", "TEA & COFFEE", "RICE GROAT CERALS ETC", "PATE", "CANS/JAR", "KISIEL&PUDDING&JELLY", "FRESH NUTS & SEEDS", "HUN-GROCER (GROCERY)", "LONG LIVE BREAD", "GROCERY ITEMS (GROCERY)",
                           "GROCERY", "ROMANIAN&RUSSIAN", "SLOVAK FOOD", "GENERAL GROCERY",
        "GROCERY - Reduced VAT", "GROCERY - Zero VAT", "GROCERY - Variable VAT",
        "ROMANIAN FOOD", "CONFECTIONERY", "TEA & COFFEE", "OIL/VINEGAR",
        "BABY FOOD", "BAKING", "CANS/JARS", "CHEMIA I KOSMETYKI",
        "EGGS", "JAJA", "JAMS,SPREADS ETC", "JARS-PICKLES", "JARS-SAUCES",
        "KETCHUP MUSTARD MAJO", "KISIEL&PUDDING&JELLY", "PASTA", "PATE",
        "POWDERY PRODUCTS", "PRZEKASKI", "READY MELAS", "SOUPS", "SPICES",
        "SYRUP", "TOMATO CONCENTRATE", "WEDLINY NA WAGE", "COFFEE-TEA",
        "MasterMedia", "ROM-GROCER", "CONFECTION", "BULGARIAN", "CANS-JARS",
        "SAUCES", "SEASONING", "BK-SPREADS", "DRY GROCER",
        "RICE GROAT CERALS ETC", "CANS/JAR", "PICKLE-VEG",
        "SLODYCZE I PRZEKASKI", "PRZETWORY MLECZARSKIE NIECH+ÜODNICZE",
        "KUCHNIA W PROSZKU", "DODATKI DO POTRAW", "FRUITS IN JAR/CAN",
        "KUCHNIA DANIA GOTOWE", "ARTYKULY SYPKIE", "FRESH NUTS & SEEDS",
        "BREAD CRUMBS", "NAPOJE GORACE", "ZDROWA ZYWNOSC", "GORACE NAPOJE",
        "OLEJE I OLIWY", "ORGANIC FOOD", "TLUSZCZE I OLEJE",
        "GROCERY /BABY FOOD", "GROCERY /BAKING", "GROCERY /BIO FOOD",
        "GROCERY /BK-SPREADS", "GROCERY /CANS-JARS", "GROCERY /COFFEE-TEA",
        "GROCERY /CONFECTION", "GROCERY /DRY GROCER", "GROCERY /EGGS",
        "GROCERY /LIT-GROCER", "GROCERY /LLMILKCREM", "GROCERY /OIL",
        "GROCERY /PACK MEAT OTHER", "GROCERY /ROM-GROCER",
        "GROCERY /RUS-GROCER", "GROCERY /SAUCES", "GROCERY /SEASONING",
        "GROCERY /SPICES","GROCERY /BULGARIAN","GROCERY /BUL-GROC"
}


        def filter_and_write(groups, sheet_name):
            filtered = summary_items_df[summary_items_df["Item Group"].isin(groups)]
            if not filtered.empty:
                totals_row = {"Product Code": "Grand Total", "Description": "", "Item Group": ""}
                for c in filtered.select_dtypes(include="number").columns:
                    totals_row[c] = filtered[c].sum()

                # percent only if sales exists and columns exist
                if sales_available and ("Sum of Sales Qty" in filtered.columns):
                    qty_col_f = next(
                        (c for c in filtered.columns if str(c).strip().lower() in ("qty", "quantity")), None
                    )
                    if qty_col_f and totals_row.get("Sum of Sales Qty", 0) and totals_row["Sum of Sales Qty"] != 0:
                        totals_row["Wastage/Sales %"] = totals_row.get(qty_col_f, 0) / totals_row["Sum of Sales Qty"]
                    else:
                        totals_row["Wastage/Sales %"] = "No Sales"

                filtered = pd.concat([pd.DataFrame([totals_row]), filtered], ignore_index=True)
                with pd.ExcelWriter(wastage_file, engine="openpyxl", mode="a", if_sheet_exists="replace") as writer:
                    filtered.to_excel(writer, sheet_name=sheet_name, index=False)

        filter_and_write(deli_groups, "Deli")
        filter_and_write(dairy_groups, "Dairy")
        filter_and_write(fruitveg_groups, "Fruit & Veg")
        filter_and_write(bakery_groups, "Bakery")
        filter_and_write(grocery_groups, "Grocery")
        print("✅ Summary Items split into category sheets.")

    # -----------------------------
    # Prepare 'items' sheet
    # - If sales missing: write items as-is (no sales merge, no percent)
    # -----------------------------
    items_to_write = df_items_remaining.copy()
    if sales_available and (not items_to_write.empty) and (not sales_summary_df.empty):
        items_cols_norm = {col: str(col).strip().lower() for col in items_to_write.columns}
        items_product_code_col = next((c for c, n in items_cols_norm.items() if n == "product code"), None)
        if items_product_code_col:
            sales_summary_clean_items = sales_summary_df[sales_summary_df["Item Code"] != "Grand Total"][
                ["Item Code", "Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]
            ].copy()
            items_to_write = items_to_write.merge(
                sales_summary_clean_items,
                left_on=items_product_code_col,
                right_on="Item Code",
                how="left",
            )
            items_to_write.drop(columns=["Item Code"], inplace=True, errors="ignore")

            qty_col_items = next((c for c, n in items_cols_norm.items() if n in ("qty", "quantity")), None)
            if qty_col_items and qty_col_items in items_to_write.columns:
                def calc_item_wastage_percent(row):
                    try:
                        sales_qty_val = float(row.get("Sum of Sales Qty", 0))
                    except (TypeError, ValueError):
                        sales_qty_val = 0
                    try:
                        wastage_qty_val = float(row.get(qty_col_items, 0))
                    except (TypeError, ValueError):
                        wastage_qty_val = 0
                    if sales_qty_val == 0:
                        return "No Sales"
                    return wastage_qty_val / sales_qty_val

                items_to_write["Wastage/Sales %"] = items_to_write.apply(calc_item_wastage_percent, axis=1)

    # -----------------------------
    # Late enhancements that depend on Sales (skip entirely if sales missing)
    # -----------------------------
    if sales_available:
        # Dept Breakdown enhancement from Summary Items
        try:
            if (
                (not dept_breakdown.empty)
                and (not summary_items_df.empty)
                and ("Item Group" in summary_items_df.columns)
                and all(col in summary_items_df.columns for col in ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"])
            ):
                items_norm = summary_items_df.copy()
                items_norm["__GroupKey"] = items_norm["Item Group"].astype(str).str.strip().str.lower()
                sales_by_group_from_items = (
                    items_norm.groupby("__GroupKey", dropna=False)[["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]]
                    .sum()
                    .reset_index()
                    .rename(columns={"__GroupKey": "__GroupKeyJoin"})
                )

                dept_rows = dept_breakdown[dept_breakdown["Dept Breakdown"] != "Grand Total"].copy()
                cols_to_clear = ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value", "Wastage/Sales %"]
                dept_rows.drop(columns=[c for c in cols_to_clear if c in dept_rows.columns], inplace=True, errors="ignore")

                dept_rows["__GroupKeyJoin"] = dept_rows["Dept Breakdown"].astype(str).str.strip().str.lower()
                dept_rows = dept_rows.merge(sales_by_group_from_items, on="__GroupKeyJoin", how="left")
                dept_rows.drop(columns=["__GroupKeyJoin"], inplace=True, errors="ignore")

                def _dept_pct(row):
                    try:
                        s_qty = float(row.get("Sum of Sales Qty", 0))
                    except (TypeError, ValueError):
                        s_qty = 0
                    try:
                        w_qty = float(row.get("Sum of Qty", 0))
                    except (TypeError, ValueError):
                        w_qty = 0
                    return "No Sales" if s_qty == 0 else (w_qty / s_qty)

                dept_rows["Wastage/Sales %"] = dept_rows.apply(_dept_pct, axis=1)

                totals_row_db = {
                    "Dept Breakdown": "Grand Total",
                    "Sum of Qty": dept_rows["Sum of Qty"].sum(),
                    "Sum of Amount": dept_rows["Sum of Amount"].sum(),
                    "Sum of Cost": dept_rows["Sum of Cost"].sum(),
                    "Sum of Sales Qty": dept_rows.get("Sum of Sales Qty", pd.Series(dtype=float)).sum(),
                    "Sum of Sales Amt.": dept_rows.get("Sum of Sales Amt.", pd.Series(dtype=float)).sum(),
                    "Sum of Cost Value": dept_rows.get("Sum of Cost Value", pd.Series(dtype=float)).sum(),
                }
                if totals_row_db.get("Sum of Sales Qty", 0):
                    totals_row_db["Wastage/Sales %"] = totals_row_db["Sum of Qty"] / totals_row_db["Sum of Sales Qty"]
                else:
                    totals_row_db["Wastage/Sales %"] = "No Sales"

                desired_cols_db = [
                    "Dept Breakdown",
                    "Sum of Qty",
                    "Sum of Amount",
                    "Sum of Cost",
                    "Sum of Sales Qty",
                    "Sum of Sales Amt.",
                    "Sum of Cost Value",
                    "Wastage/Sales %",
                ]
                other_db = [c for c in dept_rows.columns if c not in desired_cols_db]
                dept_rows = dept_rows[[c for c in desired_cols_db if c in dept_rows.columns] + other_db]
                dept_breakdown = pd.concat([pd.DataFrame([totals_row_db]), dept_rows], ignore_index=True)
        except Exception:
            pass

        # Top wasted items enhancement from Summary Items
        try:
            if (
                (not top_items.empty)
                and (not summary_items_df.empty)
                and ("Top wasted items" in top_items.columns)
                and all(col in summary_items_df.columns for col in ["Description", "Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"])
                and ("Sum of Qty" in top_items.columns)
            ):
                items_norm_desc = summary_items_df.copy()
                items_norm_desc["__DescKey"] = items_norm_desc["Description"].astype(str).str.strip().str.lower()
                sales_by_desc_from_items = (
                    items_norm_desc.groupby("__DescKey", dropna=False)[["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value"]]
                    .sum()
                    .reset_index()
                    .rename(columns={"__DescKey": "__DescKeyJoin"})
                )

                ti_rows = top_items[top_items["Top wasted items"] != "Grand Total"].copy()
                cols_to_clear_ti = ["Sum of Sales Qty", "Sum of Sales Amt.", "Sum of Cost Value", "Wastage/Sales %"]
                ti_rows.drop(columns=[c for c in cols_to_clear_ti if c in ti_rows.columns], inplace=True, errors="ignore")

                ti_rows["__DescKeyJoin"] = ti_rows["Top wasted items"].astype(str).str.strip().str.lower()
                ti_rows = ti_rows.merge(sales_by_desc_from_items, on="__DescKeyJoin", how="left")
                ti_rows.drop(columns=["__DescKeyJoin"], inplace=True, errors="ignore")

                def _ti_pct(row):
                    try:
                        s_qty = float(row.get("Sum of Sales Qty", 0))
                    except (TypeError, ValueError):
                        s_qty = 0
                    try:
                        w_qty = float(row.get("Sum of Qty", 0))
                    except (TypeError, ValueError):
                        w_qty = 0
                    return "No Sales" if s_qty == 0 else (w_qty / s_qty)

                ti_rows["Wastage/Sales %"] = ti_rows.apply(_ti_pct, axis=1)

                totals_row_ti = {k: "" for k in ti_rows.columns}
                totals_row_ti.update(
                    {
                        "Top wasted items": "Grand Total",
                        "Sum of Qty": ti_rows.get("Sum of Qty", pd.Series(dtype=float)).sum(),
                        "Sum of Amount": ti_rows.get("Sum of Amount", pd.Series(dtype=float)).sum(),
                        "Sum of Cost": ti_rows.get("Sum of Cost", pd.Series(dtype=float)).sum(),
                        "Sum of Sales Qty": ti_rows.get("Sum of Sales Qty", pd.Series(dtype=float)).sum(),
                        "Sum of Sales Amt.": ti_rows.get("Sum of Sales Amt.", pd.Series(dtype=float)).sum(),
                        "Sum of Cost Value": ti_rows.get("Sum of Cost Value", pd.Series(dtype=float)).sum(),
                    }
                )
                if totals_row_ti.get("Sum of Sales Qty", 0):
                    totals_row_ti["Wastage/Sales %"] = totals_row_ti["Sum of Qty"] / totals_row_ti["Sum of Sales Qty"]
                else:
                    totals_row_ti["Wastage/Sales %"] = "No Sales"

                desired_cols_ti = [
                    "Top wasted items",
                    *(["Product Code"] if "Product Code" in ti_rows.columns else []),
                    *(["Barcode"] if "Barcode" in ti_rows.columns else []),
                    "Sum of Qty",
                    "Sum of Amount",
                    "Sum of Cost",
                    "Sum of Sales Qty",
                    "Sum of Sales Amt.",
                    "Sum of Cost Value",
                    "Wastage/Sales %",
                ]
                other_ti = [c for c in ti_rows.columns if c not in desired_cols_ti]
                ti_rows = ti_rows[[c for c in desired_cols_ti if c in ti_rows.columns] + other_ti]
                top_items = pd.concat([pd.DataFrame([totals_row_ti]), ti_rows], ignore_index=True)
        except Exception:
            pass

    # -----------------------------
    # Write all remaining base sheets
    # - RTC sheets only if rtc_available
    # - Sales sheet only if sales_available
    # -----------------------------
    with pd.ExcelWriter(wastage_file, engine="openpyxl", mode="a", if_sheet_exists="replace") as writer:
        if "Barcode" in items_to_write.columns:
            normalize_barcode_inplace(items_to_write, "Barcode")

        items_to_write.to_excel(writer, sheet_name="items", index=False)
        df_store_use.to_excel(writer, sheet_name="Store use", index=False)

        if not dept_breakdown.empty:
            dept_breakdown.to_excel(writer, sheet_name="Dept Breakdown", index=False)
        if dept_breakdown.empty:
            raise ValueError("Wastage report is missing department or totals columns")
        if "Deli" not in writer.book.sheetnames:
            pd.DataFrame([{
                "Description": "Grand Total", "Amount": 0, "Sum of Sales Amt.": 0,
            }]).to_excel(writer, sheet_name="Deli", index=False)
        if not top_items.empty:
            top_items.to_excel(writer, sheet_name="Top wasted items", index=False)

        if rtc_available:
            if rtc_items_df is not None:
                rtc_items_df.to_excel(writer, sheet_name="RTC items", index=False)
            if rtc_admin_df is not None:
                rtc_admin_df.to_excel(writer, sheet_name="Admin RTC", index=False)
            if not rtc_summary_df.empty:
                rtc_summary_df.to_excel(writer, sheet_name="RTC", index=False)

        if sales_available and (sales_df is not None):
            sales_df.to_excel(writer, sheet_name="Sales", index=False)

        if not summary_items_df.empty:
            summary_items_df.to_excel(writer, sheet_name="Summary Items", index=False)

    # -----------------------------
    # Apply No Sales/percent formatting ONLY when sales exists
    # -----------------------------
    if sales_available:
        wb_tmp = load_workbook(wastage_file)

        def apply_no_sales_format(ws, percent_header: str, sales_qty_header: str):
            red_fill = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
            red_font = Font(color="9C0006", bold=True)
            headers = {ws.cell(row=1, column=i).value: i for i in range(1, ws.max_column + 1)}
            pct_idx = headers.get(percent_header)
            qty_idx = headers.get(sales_qty_header)
            if not pct_idx or not qty_idx:
                return
            pct_col = get_column_letter(pct_idx)
            qty_col = get_column_letter(qty_idx)
            for r in range(2, ws.max_row + 1):
                sq = ws[f"{qty_col}{r}"]
                pc = ws[f"{pct_col}{r}"]
                try:
                    v = float(sq.value)
                except (TypeError, ValueError):
                    v = 0
                if v == 0 or pc.value == "No Sales":
                    pc.value = "No Sales"
                    pc.fill = red_fill
                    pc.font = red_font
                else:
                    try:
                        pv = float(pc.value)
                        pc.value = pv
                        pc.number_format = "0.00%"
                        pc.fill = PatternFill()
                        pc.font = Font()
                    except (TypeError, ValueError):
                        pass

        # Format in these sheets if they exist
        for sn in ["items", "Dept Breakdown", "Top wasted items", "Summary Items", "Deli", "Dairy", "Fruit & Veg", "Bakery", "Grocery", "Wastage vs Sales"]:
            if sn in wb_tmp.sheetnames:
                apply_no_sales_format(wb_tmp[sn], "Wastage/Sales %", "Sum of Sales Qty")

        wb_tmp.save(wastage_file)

    # ============================================================
    # UNIVERSAL FORMATTING (except the original WastageReport tab)
    # - Yellow header with AutoFilter
    # - Bold + yellow row for any row whose any cell == "Grand Total"
    # - Auto-fit column widths
    # - £ Accounting format for specific money columns
    # ============================================================
    wb = load_workbook(wastage_file)

    pale_yellow = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")  # header
    bright_yellow = PatternFill(start_color="FFFF00", end_color="FFFF00", fill_type="solid")  # grand total
    header_font_bold = Font(bold=True)
    grand_total_font_bold = Font(bold=True)

    ACCOUNTING_GBP = '_-"£"* #,##0.00_-;_-"£"* -#,##0.00_-;_-"£"* "-"??_-;_-@_-'

    def fix_barcode_to_number(ws):
        """Convert 'Barcode' column values to integers and apply number format '0'."""
        if ws.max_row < 2 or ws.max_column == 0:
            return
        header_to_col = {ws.cell(row=1, column=ci).value: ci for ci in range(1, ws.max_column + 1)}
        col_idx = header_to_col.get("Barcode")
        if not col_idx:
            return
        for r in range(2, ws.max_row + 1):
            cell = ws.cell(row=r, column=col_idx)
            val = cell.value
            if val is None:
                continue
            sval = str(val).strip()
            if sval == "" or sval.lower() == "nan":
                cell.value = ""
                continue
            if re.match(r"^\d+$", sval):
                try:
                    cell.value = int(sval)
                    cell.number_format = "0"
                except Exception:
                    pass

    def auto_fit_columns(ws):
        for col_idx in range(1, ws.max_column + 1):
            max_len = 0
            col_letter = get_column_letter(col_idx)
            for row in range(1, ws.max_row + 1):
                val = ws.cell(row=row, column=col_idx).value
                if val is None:
                    continue
                try:
                    vlen = len(str(val))
                except Exception:
                    vlen = 0
                max_len = max(max_len, vlen)
            ws.column_dimensions[col_letter].width = min(max_len + 2, 60)

    def format_amount_cost_only(ws):
        if ws.max_row < 2 or ws.max_column == 0:
            return

        def norm(s: str) -> str:
            return str(s).strip().lower()

        target_headers = {
            "amount",
            "cost",
            "sum of amount",
            "sum of cost",
            "wastage cost",
            "wastage amount",
            "sum of sales amt.",
            "sum of cost value",
            "sale total",
            "cost each",
            "retail changed",
            "retail",
            "retail diff.",
            "sales amt.(inc. vat)",
            "cost value",
            "changed retail",
        }
        tolerant_aliases = {
            "sum of sales amt": "sum of sales amt.",
            "retail diff": "retail diff.",
            "sales amt inc vat": "sales amt.(inc. vat)",
        }
        lookup = set(target_headers) | set(tolerant_aliases.keys())

        for ci in range(1, ws.max_column + 1):
            header_val = ws.cell(row=1, column=ci).value
            if header_val is None:
                continue
            h = norm(header_val)
            if h in lookup:
                for r in range(2, ws.max_row + 1):
                    ws.cell(row=r, column=ci).number_format = ACCOUNTING_GBP

    def style_headers_grand_total_and_money(ws):
        if ws.max_row == 0 or ws.max_column == 0:
            return

        for c in ws[1]:
            c.fill = pale_yellow
            c.font = header_font_bold
        ws.auto_filter.ref = ws.dimensions

        for r in range(2, ws.max_row + 1):
            gt = False
            for c in range(1, ws.max_column + 1):
                v = ws.cell(row=r, column=c).value
                if isinstance(v, str) and v.strip().lower() == "grand total":
                    gt = True
                    break
            if gt:
                for c in range(1, ws.max_column + 1):
                    cell = ws.cell(row=r, column=c)
                    cell.fill = bright_yellow
                    cell.font = grand_total_font_bold

        format_amount_cost_only(ws)
        auto_fit_columns(ws)

    excluded_name = target_sheet
    for name in wb.sheetnames:
        if name == excluded_name:
            continue
        style_headers_grand_total_and_money(wb[name])

    # -----------------------------
    # Extra conditional formatting
    # -----------------------------
    def format_summary(ws, red_threshold_cols=None, red_threshold_value=None, highlight_col_lt=None, lt_value=None):
        max_row = ws.max_row
        headers = {ws.cell(row=1, column=col).value: col for col in range(1, ws.max_column + 1)}
        red_fill_local = PatternFill(start_color="FFC7CE", end_color="FFC7CE", fill_type="solid")
        dark_red = Font(color="9C0006")

        if red_threshold_cols and red_threshold_value is not None:
            for col_name in red_threshold_cols:
                col_idx = headers.get(col_name)
                if col_idx:
                    col_letter = get_column_letter(col_idx)
                    rng = f"{col_letter}2:{col_letter}{max_row}"
                    ws.conditional_formatting.add(
                        rng,
                        CellIsRule(
                            operator=">",
                            formula=[str(red_threshold_value)],
                            fill=red_fill_local,
                            font=dark_red,
                        ),
                    )

        if highlight_col_lt and lt_value is not None:
            col_idx = headers.get(highlight_col_lt)
            if col_idx:
                col_letter = get_column_letter(col_idx)
                rng = f"{col_letter}2:{col_letter}{max_row}"
                formula_value = f"{lt_value}" if lt_value < 0 else str(lt_value)
                ws.conditional_formatting.add(
                    rng,
                    CellIsRule(
                        operator="lessThan",
                        formula=[formula_value],
                        fill=red_fill_local,
                        font=dark_red,
                        stopIfTrue=False,
                    ),
                )

    # NOTE: fixed missing comma between "Grocery" and "items"
    for sheet_name in [
        "Wastage vs Sales",
        "Dept Breakdown",
        "Top wasted items",
        "RTC",
        "Summary Items",
        "Deli",
        "Dairy",
        "Fruit & Veg",
        "Bakery",
        "Grocery",
        "items",
    ]:
        if sheet_name in wb.sheetnames:
            if sheet_name == "RTC":
                format_summary(wb[sheet_name], highlight_col_lt="Retail Diff.", lt_value=-5)
            elif sheet_name in ["Dept Breakdown", "Top wasted items", "Deli", "Dairy", "Fruit & Veg", "Bakery", "Grocery"]:
                format_summary(
                    wb[sheet_name],
                    red_threshold_cols=["Sum of Amount", "Sum of Cost", "Cost", "Amount"],
                    red_threshold_value=25,
                )
            else:
                format_summary(wb[sheet_name])

            if sheet_name in ["Wastage vs Sales", "Top wasted items", "items"]:
                fix_barcode_to_number(wb[sheet_name])

    wb.save(wastage_file)

    if not rtc_available:
        print("ℹ️ RTC.xlsx was missing → RTC reading + RTC sheets were skipped.")
    if not sales_available:
        print("ℹ️ sales.xlsx was missing → Sales reading + sales merges/percent were skipped (wastage-only outputs written).")

    print("✅ All sheets updated with formatting (wastage required; RTC/Sales optional).")


if __name__ == "__main__":
    main()
