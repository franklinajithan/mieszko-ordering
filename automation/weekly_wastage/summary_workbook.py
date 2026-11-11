import argparse
import re
from pathlib import Path
from datetime import datetime

from openpyxl import load_workbook, Workbook
from openpyxl.styles import Font, Alignment, Border, Side, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.chart import BarChart, Reference


# ------------------------- Helpers -------------------------

def norm(s) -> str:
    return re.sub(r"[\s\.\n\r\t:]+", "", str(s or "")).lower()


def norm_filename(s) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def detect_period_from_folder(root_dir: Path) -> str | None:
    """
    Detect monthly period from folder names such as:
      Monthly Waste August 2026
    Returns:
      August 2026
    """
    m = re.match(
        r"^Monthly Waste\s+"
        r"(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"\s+(\d{4})$",
        root_dir.name,
        flags=re.IGNORECASE,
    )
    if not m:
        return None

    month = m.group(1).capitalize()
    year = m.group(2)
    return f"{month} {year}"


def pick_wastage_file(store_dir: Path, pattern: str) -> Path | None:
    files = list(store_dir.glob(pattern))
    if not files:
        return None
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)  # latest first
    return files[0]



def pick_sales_file(store_dir: Path, pattern: str = "*_Sales_*.xlsx") -> Path | None:
    """Find newest Product Sales workbook, excluding department-sales files."""
    candidates = []

    for p in store_dir.glob("*.xlsx"):
        if p.name.startswith("~$"):
            continue

        compact = norm_filename(p.stem)

        if "sales" not in compact:
            continue

        if "salesbydepartment" in compact:
            continue

        if p.match(pattern) or "sales" in compact:
            candidates.append(p)

    if not candidates:
        return None

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def _to_float(x):
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "")
    if s == "" or norm(s) == "nan":
        return None
    try:
        return float(s)
    except Exception:
        return None


def find_grand_total_from_dept_breakdown(wb_path: Path, sheet_name: str = "Dept Breakdown"):
    """
    Dept Breakdown sheet:
      A = Dept Breakdown
      B = Sum of Qty
      C = Sum of Amount
      D = Sum of Cost   ✅ Wastage Cost

    Find row where col A == 'Grand Total' and return:
      (qty from B, retail from C, cost from D)
    """
    wb = load_workbook(wb_path, data_only=True)
    if sheet_name not in wb.sheetnames:
        raise ValueError(f"Sheet '{sheet_name}' not found")

    ws = wb[sheet_name]

    for r in range(1, ws.max_row + 1):
        if norm(ws.cell(r, 1).value) == "grandtotal":
            qty = _to_float(ws.cell(r, 2).value) or 0.0
            retail = _to_float(ws.cell(r, 3).value) or 0.0
            cost = _to_float(ws.cell(r, 4).value) or 0.0
            return (qty, retail, cost)

    raise ValueError(f"'Grand Total' not found in '{sheet_name}'")


def extract_sales_amount(sales_path: Path):
    """
    Robust Sales extractor:
    - scans all sheets
    - finds header 'Sales Amt.(Inc. VAT)' (normalized to salesamt(incvat))
    - finds row containing 'Grand Total'
    - returns Sales Amt value from that column
    """
    wb = load_workbook(sales_path, data_only=True)
    target_header = "salesamt(incvat)"

    def coerce_float(x, context: str):
        v = _to_float(x)
        if v is None:
            raise ValueError(f"{context}: Sales Amt is not numeric/empty")
        return v

    for ws in wb.worksheets:
        header_row = None
        sales_amt_col = None

        scan_rows = min(80, ws.max_row)
        scan_cols = min(ws.max_column, 200)

        # find header cell
        for r in range(1, scan_rows + 1):
            for c in range(1, scan_cols + 1):
                if norm(ws.cell(r, c).value) == target_header:
                    header_row = r
                    sales_amt_col = c
                    break
            if sales_amt_col:
                break

        if not sales_amt_col:
            continue

        # find grand total row
        for r in range(header_row + 1, ws.max_row + 1):
            b_val = ws.cell(r, 2).value
            if "grandtotal" in norm(b_val):
                return coerce_float(ws.cell(r, sales_amt_col).value, f"{ws.title} Grand Total")

            # fallback: scan row for grand total text
            for c in range(1, min(ws.max_column, 40) + 1):
                if "grandtotal" in norm(ws.cell(r, c).value):
                    return coerce_float(ws.cell(r, sales_amt_col).value, f"{ws.title} Grand Total")

    raise ValueError("Could not find Sales Amt.(Inc. VAT) + Grand Total in any sheet")


def extract_deli_metrics_from_wastage(wastage_path: Path, sheet_name: str = "Deli"):
    """
    Deli sheet (robust):
      - Find row where column A == 'Grand Total'
      - Find columns by header text:
          'Amount'
          'Sum of Sales Am' / 'Sum of Sales Amt' / 'Sum of Sales Amount'
      - Read values from the Grand Total row in those columns
    """
    wb = load_workbook(wastage_path, data_only=True)
    if sheet_name not in wb.sheetnames:
        raise ValueError(f"Sheet '{sheet_name}' not found")

    ws = wb[sheet_name]

    # 1) Find Grand Total row (Column A)
    grand_row = None
    for r in range(1, ws.max_row + 1):
        if norm(ws.cell(r, 1).value) == "grandtotal":
            grand_row = r
            break
    if not grand_row:
        raise ValueError("'Grand Total' not found in Deli sheet (Column A)")

    # 2) Detect header row & required columns (scan first 10 rows)
    amount_col = None
    sales_col = None

    for r in range(1, min(10, ws.max_row) + 1):
        for c in range(1, ws.max_column + 1):
            h = norm(ws.cell(r, c).value)

            if h == "amount":
                amount_col = c

            if h in ("sumofsalesam", "sumofsalesamt", "sumofsalesamount"):
                sales_col = c

        if amount_col and sales_col:
            break

    if not amount_col:
        raise ValueError("Could not find header 'Amount' in Deli sheet")
    if not sales_col:
        raise ValueError("Could not find header like 'Sum of Sales Am(t)' in Deli sheet")

    # 3) Read values from Grand Total row using detected columns
    deli_waste = _to_float(ws.cell(grand_row, amount_col).value) or 0.0
    deli_sales = _to_float(ws.cell(grand_row, sales_col).value) or 0.0
    deli_pct = (deli_waste / deli_sales) if deli_sales else 0.0

    return deli_waste, deli_sales, deli_pct


def pick_department_sales_file(store_dir: Path, store: str) -> Path | None:
    """
    Supports:
      <Store>_Sales by Department.xlsx
      <Store>_Daily_Sales_by_Department_<dates>.xlsx
    """
    exact = store_dir / f"{store}_Sales by Department.xlsx"
    if exact.exists():
        return exact

    candidates = []

    for p in store_dir.glob("*.xlsx"):
        if p.name.startswith("~$"):
            continue

        compact = norm_filename(p.stem)

        if "salesbydepartment" in compact:
            candidates.append(p)

    if not candidates:
        return None

    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def extract_fresh_food_sales(dept_sales_path: Path):
    """
    Read the 'Sales by Department' workbook and return sales for:
      - DELI
      - DELI COUNTER
      - FRESH MEAT

    The function searches all worksheets, detects the 'Item Group' and
    'Sales Amt.' columns, and then reads the matching department rows.

    Returns:
        {
            "deli": ...,
            "deli_counter": ...,
            "fresh_meat": ...,
            "total": ...
        }
    """
    wb = load_workbook(dept_sales_path, data_only=True)

    targets = {
        "deli": "deli",
        "delicounter": "deli_counter",
        "freshmeat": "fresh_meat",
    }

    found = {
        "deli": None,
        "deli_counter": None,
        "fresh_meat": None,
    }

    for ws in wb.worksheets:
        item_group_col = None
        sales_amt_col = None
        header_row = None

        scan_rows = min(ws.max_row, 100)
        scan_cols = min(ws.max_column, 200)

        # Find a header row containing Item Group and Sales Amt.
        for r in range(1, scan_rows + 1):
            row_item_col = None
            row_sales_col = None

            for c in range(1, scan_cols + 1):
                h = norm(ws.cell(r, c).value)

                if h in ("itemgroup", "department", "dept"):
                    row_item_col = c

                # Examples after normalization:
                # "Sales Amt." -> "salesamt"
                # "Sales Amount" -> "salesamount"
                # "Sales Amt.(Inc. VAT)" -> "salesamt(incvat)"
                if h in ("salesamt", "salesamount", "salesamt(incvat)", "salesamount(incvat)"):
                    row_sales_col = c

            if row_item_col and row_sales_col:
                item_group_col = row_item_col
                sales_amt_col = row_sales_col
                header_row = r
                break

        # Primary method: use detected columns
        if header_row and item_group_col and sales_amt_col:
            for r in range(header_row + 1, ws.max_row + 1):
                label = norm(ws.cell(r, item_group_col).value)
                if label in targets:
                    key = targets[label]
                    value = _to_float(ws.cell(r, sales_amt_col).value)
                    if value is not None:
                        found[key] = value

        # Fallback for unusual report layouts:
        # Find target department labels anywhere and take the first numeric
        # value to the right on the same row (preferring the closest one).
        for r in range(1, ws.max_row + 1):
            for c in range(1, min(ws.max_column, 80) + 1):
                label = norm(ws.cell(r, c).value)
                if label not in targets:
                    continue

                key = targets[label]
                if found[key] is not None:
                    continue

                for value_col in range(c + 1, min(ws.max_column, c + 25) + 1):
                    value = _to_float(ws.cell(r, value_col).value)
                    if value is not None:
                        found[key] = value
                        break

        if all(v is not None for v in found.values()):
            break

    # ---------------------------------------------------------
    # If any department category is missing, use £0.00 ONLY for
    # that category. Do not fail the whole store.
    # ---------------------------------------------------------
    department_names = {
        "deli": "DELI",
        "deli_counter": "DELI COUNTER",
        "fresh_meat": "FRESH MEAT",
    }

    for key, display_name in department_names.items():
        if found[key] is None:
            found[key] = 0.0
            print(
                f"[DEPT INFO] {dept_sales_path.stem} | "
                f"{display_name} row not present -> using 0.00"
            )

    total = (
        found["deli"]
        + found["deli_counter"]
        + found["fresh_meat"]
    )

    return {
        "deli": found["deli"],
        "deli_counter": found["deli_counter"],
        "fresh_meat": found["fresh_meat"],
        "total": total,
    }


def create_fresh_food_sheet(wb, stores, dept_results, period_text):
    """
    Create Sheet 2: 'Fresh Food Sales'

    Table:
      Store | DELI | DELI COUNTER | FRESH MEAT | Total Fresh Food Sales

    Also creates a bar chart showing Total Fresh Food Sales by store.
    """
    ws = wb.create_sheet("Fresh Food Sales", 1)

    # Title
    ws.merge_cells("A1:E1")
    ws["A1"] = "Monthly Deli Sales"
    ws["A1"].font = Font(bold=True, size=16)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

    ws.merge_cells("A2:E2")
    ws["A2"] = f"Period: {period_text}"
    ws["A2"].font = Font(italic=True)
    ws["A2"].alignment = Alignment(horizontal="center", vertical="center")

    headers = ["Store", "DELI", "DELI COUNTER", "FRESH MEAT", "Total Deli Sales"]
    for col, header in enumerate(headers, start=1):
        cell = ws.cell(4, col)
        cell.value = header
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.fill = PatternFill("solid", fgColor="D9EAF7")

    thin = Side(style="thin", color="B7B7B7")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    first_data_row = 5
    for row_idx, store in enumerate(stores, start=first_data_row):
        data = dept_results.get(store, {})

        ws.cell(row_idx, 1).value = store
        ws.cell(row_idx, 2).value = data.get("deli", 0.0) if data else 0.0
        ws.cell(row_idx, 3).value = data.get("deli_counter", 0.0) if data else 0.0
        ws.cell(row_idx, 4).value = data.get("fresh_meat", 0.0) if data else 0.0

        # Always calculate the total. Missing categories are treated as £0.00.
        ws.cell(row_idx, 5).value = f"=SUM(B{row_idx}:D{row_idx})"

        for col in range(1, 6):
            cell = ws.cell(row_idx, col)
            cell.border = border
            cell.alignment = Alignment(
                horizontal="left" if col == 1 else "right",
                vertical="center"
            )
            if col >= 2:
                cell.number_format = '£#,##0.00'

    # Border the headers too
    for col in range(1, 6):
        ws.cell(4, col).border = border

    # Add Grand Total row
    total_row = first_data_row + len(stores)
    ws.cell(total_row, 1).value = "Grand Total"
    ws.cell(total_row, 1).font = Font(bold=True)

    for col in range(2, 6):
        letter = get_column_letter(col)
        ws.cell(total_row, col).value = f"=SUM({letter}{first_data_row}:{letter}{total_row - 1})"
        ws.cell(total_row, col).font = Font(bold=True)
        ws.cell(total_row, col).number_format = '£#,##0.00'

    for col in range(1, 6):
        ws.cell(total_row, col).border = border
        ws.cell(total_row, col).fill = PatternFill("solid", fgColor="E2F0D9")

    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 18
    ws.column_dimensions["E"].width = 24
    ws.freeze_panes = "A5"

    # Chart: Total Fresh Food Sales by Store
    if stores:
        chart = BarChart()
        chart.type = "col"
        chart.style = 10
        chart.title = "Total Deli Sales by Store"
        chart.y_axis.title = "Sales (£)"
        chart.x_axis.title = "Store"
        chart.height = 10
        chart.width = 20

        data = Reference(
            ws,
            min_col=5,
            min_row=4,
            max_row=total_row - 1
        )
        cats = Reference(
            ws,
            min_col=1,
            min_row=5,
            max_row=total_row - 1
        )

        chart.add_data(data, titles_from_data=True)
        chart.set_categories(cats)
        chart.legend = None
        ws.add_chart(chart, "G4")

    return ws


def extract_rtc_grand_total(wastage_path: Path, sheet_name: str = "RTC"):
    """
    Read the RTC sheet from a store wastage workbook and return
    Grand Total values for:
      - Retail
      - Changed Retail
      - Retail Diff.

    The function detects the header columns by name and then reads
    the row where Sale Description == 'Grand Total'.
    """
    wb = load_workbook(wastage_path, data_only=True)

    if sheet_name not in wb.sheetnames:
        raise ValueError(f"Sheet '{sheet_name}' not found")

    ws = wb[sheet_name]

    header_row = None
    sale_desc_col = None
    retail_col = None
    changed_retail_col = None
    retail_diff_col = None

    scan_rows = min(ws.max_row, 50)
    scan_cols = min(ws.max_column, 100)

    for r in range(1, scan_rows + 1):
        row_sale_desc = None
        row_retail = None
        row_changed = None
        row_diff = None

        for c in range(1, scan_cols + 1):
            h = norm(ws.cell(r, c).value)

            if h in ("saledescription", "description"):
                row_sale_desc = c
            elif h == "retail":
                row_retail = c
            elif h in ("changedretail", "changedretailvalue"):
                row_changed = c
            elif h in ("retaildiff", "retaildifference"):
                row_diff = c

        if row_sale_desc and row_retail and row_changed and row_diff:
            header_row = r
            sale_desc_col = row_sale_desc
            retail_col = row_retail
            changed_retail_col = row_changed
            retail_diff_col = row_diff
            break

    if not header_row:
        raise ValueError("Could not detect RTC headers: Sale Description, Retail, Changed Retail, Retail Diff.")

    grand_row = None
    for r in range(header_row + 1, ws.max_row + 1):
        if norm(ws.cell(r, sale_desc_col).value) == "grandtotal":
            grand_row = r
            break

    if not grand_row:
        raise ValueError("'Grand Total' row not found in RTC sheet")

    retail = _to_float(ws.cell(grand_row, retail_col).value) or 0.0
    changed_retail = _to_float(ws.cell(grand_row, changed_retail_col).value) or 0.0
    retail_diff = _to_float(ws.cell(grand_row, retail_diff_col).value)

    # If Retail Diff is blank, calculate it using Changed Retail - Retail
    if retail_diff is None:
        retail_diff = changed_retail - retail

    return {
        "retail": retail,
        "changed_retail": changed_retail,
        "retail_diff": retail_diff,
    }


def create_rtc_summary_sheet(wb, stores, rtc_results, period_text):
    """
    Create a separate sheet containing all store RTC Grand Totals:
      Store | Retail | Changed Retail | Retail Diff.
    """
    ws = wb.create_sheet("RTC Summary", 2)

    ws.merge_cells("A1:D1")
    ws["A1"] = "Monthly RTC Summary"
    ws["A1"].font = Font(bold=True, size=16)
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")

    ws.merge_cells("A2:D2")
    ws["A2"] = f"Period: {period_text}"
    ws["A2"].font = Font(italic=True)
    ws["A2"].alignment = Alignment(horizontal="center", vertical="center")

    headers = ["Store", "Retail", "Changed Retail", "Retail Diff."]
    for col, header in enumerate(headers, start=1):
        cell = ws.cell(4, col)
        cell.value = header
        cell.font = Font(bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.fill = PatternFill("solid", fgColor="D9EAF7")

    thin = Side(style="thin", color="B7B7B7")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    first_data_row = 5

    for row_idx, store in enumerate(stores, start=first_data_row):
        data = rtc_results.get(store, {})

        ws.cell(row_idx, 1).value = store
        ws.cell(row_idx, 2).value = data.get("retail")
        ws.cell(row_idx, 3).value = data.get("changed_retail")
        ws.cell(row_idx, 4).value = data.get("retail_diff")

        for col in range(1, 5):
            cell = ws.cell(row_idx, col)
            cell.border = border
            cell.alignment = Alignment(
                horizontal="left" if col == 1 else "right",
                vertical="center"
            )
            if col >= 2:
                cell.number_format = '£#,##0.00'

    for col in range(1, 5):
        ws.cell(4, col).border = border

    # Grand Total
    total_row = first_data_row + len(stores)
    ws.cell(total_row, 1).value = "Grand Total"
    ws.cell(total_row, 1).font = Font(bold=True)

    for col in range(2, 5):
        letter = get_column_letter(col)
        ws.cell(total_row, col).value = f"=SUM({letter}{first_data_row}:{letter}{total_row - 1})"
        ws.cell(total_row, col).font = Font(bold=True)
        ws.cell(total_row, col).number_format = '£#,##0.00'

    for col in range(1, 5):
        ws.cell(total_row, col).border = border
        ws.cell(total_row, col).fill = PatternFill("solid", fgColor="E2F0D9")

    ws.column_dimensions["A"].width = 18
    ws.column_dimensions["B"].width = 16
    ws.column_dimensions["C"].width = 18
    ws.column_dimensions["D"].width = 16
    ws.freeze_panes = "A5"

    return ws


# ------------------------- Styling -------------------------

def style_sheet(ws, stores):
    bold = Font(bold=True)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    left = Alignment(horizontal="left", vertical="center")

    thin = Side(style="thin", color="000000")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    store_fills = {
        "Perivale":  "F8DED3",
        "Streatham": "CFEFFF",
        "Eastham":   "D7F4D7",
        "Hounslow":  "CFEFFF",
        "Watford":   "F6C7F1",
        "Gravesend": "DFF2D2",
        "Hayes":     "D9D9D9",
        "Sudbury":   "BFEFF3",
    }

    max_col = 1 + len(stores)

    # Left labels A1..A10
    for r in range(1, 11):
        cell = ws.cell(r, 1)
        cell.font = bold
        cell.alignment = left
        cell.border = border
    ws["A1"].alignment = center

    ws.column_dimensions["A"].width = 18
    for i in range(2, max_col + 1):
        ws.column_dimensions[get_column_letter(i)].width = 16

    ws.freeze_panes = "B3"

    for col_idx, store in enumerate(stores, start=2):
        fill_hex = store_fills.get(store, "FFFFFF")
        fill = PatternFill("solid", fgColor=fill_hex)

        for r in range(1, 11):
            cell = ws.cell(r, col_idx)
            cell.border = border
            cell.alignment = center
            cell.fill = fill
            if r in (1, 2):
                cell.font = bold

        # Number formats
        ws.cell(3, col_idx).number_format = "0.000"
        ws.cell(4, col_idx).number_format = "£#,##0.00"
        ws.cell(5, col_idx).number_format = "£#,##0.00"
        ws.cell(6, col_idx).number_format = "£#,##0.00"
        ws.cell(7, col_idx).number_format = "0.00%"

        ws.cell(8, col_idx).number_format = "£#,##0.00"  # Deli Waste
        ws.cell(9, col_idx).number_format = "£#,##0.00"  # Deli Sales
        ws.cell(10, col_idx).number_format = "0.00%"     # Deli %


# ------------------------- Main Build -------------------------

def set_weekly_total_waste(sheet):
    changed = sheet["A7"].value != "Total Waste %"
    sheet["A7"] = "Total Waste %"
    for column in range(2, sheet.max_column + 1):
        if sheet.cell(1, column).value is None:
            continue
        letter = get_column_letter(column)
        cell = sheet.cell(7, column)
        formula = f"={letter}5/{letter}6"
        if cell.value != formula or cell.number_format != "0.00%":
            cell.value = formula
            cell.number_format = "0.00%"
            changed = True
    return changed


def build_summary(root_dir: Path, period_text: str, output_path: Path, wastage_pattern: str, sales_pattern: str, summary_title="Monthly Summary"):
    store_dirs = [p for p in root_dir.iterdir() if p.is_dir()]
    store_dirs.sort(key=lambda p: p.name.lower())

    all_stores = [p.name for p in store_dirs]
    results = {}
    errors = []

    # Separate results/errors for '<Store>_Sales by Department.xlsx'
    # so a missing department report does NOT stop the normal monthly summary.
    dept_results = {}
    dept_errors = []

    # RTC Grand Total results from each store wastage workbook
    rtc_results = {}
    rtc_errors = []

    for store_dir in store_dirs:
        store = store_dir.name

        # -----------------------------------------------------
        # Fresh Food Sales from '<Store>_Sales by Department.xlsx'
        # -----------------------------------------------------
        dept_sales_file = pick_department_sales_file(store_dir, store)

        if not dept_sales_file:
            dept_errors.append(f"{store}: Missing Sales by Department workbook")
        else:
            try:
                fresh_food = extract_fresh_food_sales(dept_sales_file)
                fresh_food["file"] = dept_sales_file.name
                dept_results[store] = fresh_food

                print(
                    f"[DEPT OK] {store} | DELI={fresh_food['deli']:.2f} "
                    f"| DELI COUNTER={fresh_food['deli_counter']:.2f} "
                    f"| FRESH MEAT={fresh_food['fresh_meat']:.2f} "
                    f"| TOTAL={fresh_food['total']:.2f}"
                )
            except Exception as e:
                dept_errors.append(f"{store}: {e} (Department Sales={dept_sales_file.name})")

        wastage_file = pick_wastage_file(store_dir, wastage_pattern)
        sales_file = pick_sales_file(store_dir, sales_pattern)

        if not wastage_file:
            errors.append(f"{store}: Missing wastage file ({wastage_pattern})")
            rtc_errors.append(f"{store}: Missing wastage file ({wastage_pattern})")
            continue

        # Read RTC Grand Total from the wastage workbook
        try:
            rtc_data = extract_rtc_grand_total(wastage_file)
            rtc_data["file"] = wastage_file.name
            rtc_results[store] = rtc_data

            print(
                f"[RTC OK] {store} | Retail={rtc_data['retail']:.2f} "
                f"| Changed Retail={rtc_data['changed_retail']:.2f} "
                f"| Retail Diff={rtc_data['retail_diff']:.2f}"
            )
        except Exception as e:
            rtc_errors.append(f"{store}: {e} (Wastage={wastage_file.name})")

        if not sales_file:
            errors.append(f"{store}: Missing Product Sales file ({sales_pattern})")
            continue

        try:
            qty, retail, cost = find_grand_total_from_dept_breakdown(wastage_file)
            sales_amt = extract_sales_amount(sales_file)
            pct = (cost / sales_amt) if sales_amt else 0.0

            deli_waste, deli_sales, deli_pct = extract_deli_metrics_from_wastage(wastage_file)

            results[store] = {
                "period": period_text,
                "qty": qty,
                "cost": cost,
                "retail": retail,
                "sales": sales_amt,
                "pct": pct,
                "deli_waste": deli_waste,
                "deli_sales": deli_sales,
                "deli_pct": deli_pct,
                "wastage_file": wastage_file.name,
            }

            print(
                f"[OK] {store} | Qty={qty:.3f} | Cost={cost:.2f} | Retail={retail:.2f} | Sales={sales_amt:.2f} "
                f"| DeliWaste={deli_waste:.2f} | DeliSales={deli_sales:.2f} | Deli%={deli_pct:.4%}"
            )

        except Exception as e:
            errors.append(f"{store}: {e} (Wastage={wastage_file.name})")

    wb = Workbook()
    ws = wb.active
    ws.title = summary_title

    ws["A1"] = "Stores"
    ws["A2"] = "Period"
    ws["A3"] = "Wastage Qty"
    ws["A4"] = "Wastage Cost"
    ws["A5"] = "Wastage Retail"
    ws["A6"] = "Sales Amount"
    ws["A7"] = "%"

    ws["A8"] = "Deli Waste"
    ws["A9"] = "Deli Sales"
    ws["A10"] = "Deli Waste by %"

    for idx, store in enumerate(all_stores, start=2):
        ws.cell(1, idx).value = store
        ws.cell(2, idx).value = results.get(store, {}).get("period", period_text)

        ws.cell(3, idx).value = results.get(store, {}).get("qty", None)
        ws.cell(4, idx).value = results.get(store, {}).get("cost", None)
        ws.cell(5, idx).value = results.get(store, {}).get("retail", None)
        ws.cell(6, idx).value = results.get(store, {}).get("sales", None)
        ws.cell(7, idx).value = results.get(store, {}).get("pct", None)

        ws.cell(8, idx).value = results.get(store, {}).get("deli_waste", None)

        # Deli Sales must use the Total Deli Sales calculated from:
        # DELI + DELI COUNTER + FRESH MEAT
        # in the Sales by Department workbook.
        total_deli_sales = dept_results.get(store, {}).get("total", None)
        ws.cell(9, idx).value = total_deli_sales

        # Recalculate Deli Waste % using the new Total Deli Sales value.
        deli_waste = results.get(store, {}).get("deli_waste", None)
        if deli_waste is not None and total_deli_sales:
            ws.cell(10, idx).value = deli_waste / total_deli_sales
        else:
            ws.cell(10, idx).value = None

    if summary_title == "Weekly Summary":
        set_weekly_total_waste(ws)
    style_sheet(ws, all_stores)

    # Sheet 2: Deli Sales + chart
    create_fresh_food_sheet(wb, all_stores, dept_results, period_text)

    # Sheet 3: RTC totals from every store wastage workbook
    create_rtc_summary_sheet(wb, all_stores, rtc_results, period_text)

    log = wb.create_sheet("Log")
    log["A1"] = "Generated at"
    log["B1"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log["A2"] = "Period"
    log["B2"] = period_text

    log["A4"] = "Store"
    log["B4"] = "Status"
    log["C4"] = "Wastage File"
    log["D4"] = "Message"
    log["E4"] = "Department Sales Status"
    log["F4"] = "Department Sales File"
    log["G4"] = "Department Sales Message"
    log["H4"] = "RTC Status"
    log["I4"] = "RTC File"
    log["J4"] = "RTC Message"

    rr = 5
    for store in all_stores:
        if store in results:
            log.cell(rr, 1).value = store
            log.cell(rr, 2).value = "OK"
            log.cell(rr, 3).value = results[store].get("wastage_file", "")
            log.cell(rr, 4).value = ""
        else:
            msg = next((e for e in errors if e.startswith(store + ":")), "Unknown issue")
            log.cell(rr, 1).value = store
            log.cell(rr, 2).value = "FAILED"
            log.cell(rr, 3).value = ""
            log.cell(rr, 4).value = msg

        if store in dept_results:
            log.cell(rr, 5).value = "OK"
            log.cell(rr, 6).value = dept_results[store].get("file", "")
            log.cell(rr, 7).value = ""
        else:
            dept_msg = next(
                (e for e in dept_errors if e.startswith(store + ":")),
                "Unknown department sales issue"
            )
            log.cell(rr, 5).value = "FAILED"
            log.cell(rr, 6).value = ""
            log.cell(rr, 7).value = dept_msg

        if store in rtc_results:
            log.cell(rr, 8).value = "OK"
            log.cell(rr, 9).value = rtc_results[store].get("file", "")
            log.cell(rr, 10).value = ""
        else:
            rtc_msg = next(
                (e for e in rtc_errors if e.startswith(store + ":")),
                "Unknown RTC issue"
            )
            log.cell(rr, 8).value = "FAILED"
            log.cell(rr, 9).value = ""
            log.cell(rr, 10).value = rtc_msg

        rr += 1

    wb.save(output_path)
    return results, errors, dept_results, dept_errors, rtc_results, rtc_errors


def main():
    parser = argparse.ArgumentParser(description="Build monthly wastage summary from store folders.")
    parser.add_argument("--root", default=".", help="Root folder (default: current folder)")
    parser.add_argument("--period", default=None, help="Period text (default: auto from folder name)")
    parser.add_argument("--out", default="Monthly_Wastage_Summary.xlsx", help="Output Excel file name")
    parser.add_argument("--wastage-pattern", default="*_Wastage_*.xlsx", help="Wastage file glob pattern")
    parser.add_argument("--sales-pattern", default="*_Sales_*.xlsx", help="Product Sales file glob pattern")
    args = parser.parse_args()

    root_dir = Path(args.root).expanduser().resolve()
    if not root_dir.exists():
        raise SystemExit(f"Root folder not found: {root_dir}")

    period = args.period or detect_period_from_folder(root_dir) or datetime.now().strftime("%B %Y")
    out_path = (root_dir / args.out).resolve()

    print(f"[INFO] Root: {root_dir}")
    print(f"[INFO] Period: {period}")
    print(f"[INFO] Output: {out_path}")
    print(f"[INFO] Wastage pattern: {args.wastage_pattern}")
    print(f"[INFO] Sales pattern: {args.sales_pattern}")

    results, errors, dept_results, dept_errors, rtc_results, rtc_errors = build_summary(
        root_dir,
        period,
        out_path,
        args.wastage_pattern,
        args.sales_pattern
    )

    print(f"\n✅ Created: {out_path}")
    print(f"✅ Monthly Summary stores OK: {len(results)}")
    print(f"✅ Department Sales stores OK: {len(dept_results)}")
    print(f"✅ RTC stores OK: {len(rtc_results)}")

    if errors:
        print("\n⚠️ Monthly Summary Issues:")
        for e in errors:
            print(" -", e)

    if dept_errors:
        print("\n⚠️ Department Sales Issues:")
        for e in dept_errors:
            print(" -", e)

    if rtc_errors:
        print("\n⚠️ RTC Issues:")
        for e in rtc_errors:
            print(" -", e)


if __name__ == "__main__":
    main()
