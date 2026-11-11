
// Program code mapping
const PROGRAMS = {
  BSIT: "Bachelor of Science in Information Technology",
  BSCS: "Bachelor of Science in Computer Science",
  BSIS: "Bachelor of Science in Information Systems"
};

const output = document.getElementById("output");
const message = document.getElementById("message");
const downloadBtn = document.getElementById("downloadBtn");

let jsonData = null;

document.querySelectorAll(".source-file input").forEach(input => {
  const source = input.closest(".source-file");
  const fileName = source.querySelector(".file-name");
  const action = source.querySelector(".file-action");

  input.addEventListener("change", () => {
    const file = input.files[0];
    fileName.textContent = file ? file.name : fileName.dataset.default;
    action.textContent = file ? "Replace" : "Choose file";
    source.toggleAttribute("data-selected", Boolean(file));
  });
});

// Parse CSV text
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  text = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;

      row.push(field);
      field = "";

      if (row.some(value => value.trim() !== "")) {
        rows.push(row);
      }

      row = [];
    } else {
      field += c;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unclosed quotation mark.");
  }

  row.push(field);

  if (row.some(value => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

// Convert CSV rows to objects
function csvToObjects(text, requiredColumns, sourceName) {
  const rows = parseCSV(text);

  if (rows.length === 0) {
    throw new Error(sourceName + " is empty.");
  }

  const headers = rows.shift().map(h => h.trim().toLowerCase());

  const missing = requiredColumns.filter(
    column => !headers.includes(column)
  );

  if (missing.length > 0) {
    throw new Error(
      sourceName + " missing column(s): " + missing.join(", ")
    );
  }

  return rows.map((row, index) => {
    if (row.length !== headers.length) {
      throw new Error(
        sourceName + " has an invalid number of columns at data row " +
        (index + 1)
      );
    }

    const obj = {};

    headers.forEach((header, i) => {
      obj[header] = row[i].trim();
    });

    return obj;
  });
}

// Proper case for student names
function capitalizeWords(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (match, separator, letter) => {
      return separator + letter.toUpperCase();
    });
}

// Normalize completion status
function normalizeStatus(value) {
  return capitalizeWords(value);
}

// Convert student ID to integer
function parseStudentId(value) {
  const text = String(value).trim();

  if (!/^\d+$/.test(text)) {
    throw new Error("Invalid student ID: " + text);
  }

  const id = Number(text);

  if (!Number.isSafeInteger(id)) {
    throw new Error("Student ID is too large: " + text);
  }

  return id;
}

// Convert grades
function normalizeGrade(value) {
  const grade = value.trim();

  if (grade === "") {
    return null;
  }

  // Numeric grades become numbers
  if (Number.isFinite(Number(grade))) {
    return Number(grade);
  }

  // INC and other non-numeric grades remain strings
  return grade.toUpperCase();
}

// Convert account balances
function normalizeBalance(value) {
  const balance = value.trim().replace(/,/g, "");

  if (balance === "") {
    return null;
  }

  const number = Number(balance);

  if (!Number.isFinite(number)) {
    throw new Error("Invalid account balance: " + value);
  }

  return number;
}

// Transform SIS records
function transformSIS(record) {
  const programCode = record.program_code.trim().toUpperCase();

  return {
    studentId: parseStudentId(record.student_id),
    studentName: capitalizeWords(record.student_name),
    program: PROGRAMS[programCode] || programCode,
    emailAddress: record.email.trim().toLowerCase(),
    courses: [],
    outstandingBalance: null,
    currency: null
  };
}

// Transform LMS records
function transformLMS(record) {
  return {
    studentId: parseStudentId(record.student_id),
    courseCode: record.course_code.trim().toUpperCase(),
    finalGrade: normalizeGrade(record.final_grade),
    completionStatus: normalizeStatus(record.completion_status)
  };
}

// Transform Accounting records
function transformAccounting(record) {
  return {
    studentId: parseStudentId(record.student_id),
    outstandingBalance: normalizeBalance(record.account_balance),
    currency: record.currency.trim().toUpperCase() || null
  };
}

// Read uploaded file
function readFile(file) {
  return file.text();
}

// Display status message
function showMessage(text, isError = false) {
  message.dataset.state = isError ? "error" : "success";
  message.textContent = text;
}

// ETL process
document.getElementById("convertBtn").addEventListener("click", async () => {
  const sisFile = document.getElementById("sisFile").files[0];
  const lmsFile = document.getElementById("lmsFile").files[0];
  const accountingFile = document.getElementById("accountingFile").files[0];

  jsonData = null;
  downloadBtn.disabled = true;

  if (!sisFile || !lmsFile || !accountingFile) {
    showMessage("Please upload all three CSV files.", true);
    return;
  }

  try {
    // TASK 1: EXTRACT
    const [sisText, lmsText, accountingText] = await Promise.all([
      readFile(sisFile),
      readFile(lmsFile),
      readFile(accountingFile)
    ]);

    const sisRecords = csvToObjects(
      sisText,
      ["student_id", "student_name", "program_code", "email"],
      "SIS"
    );

    const lmsRecords = csvToObjects(
      lmsText,
      ["student_id", "course_code", "final_grade", "completion_status"],
      "LMS"
    );

    const accountingRecords = csvToObjects(
      accountingText,
      ["student_id", "account_balance", "currency"],
      "Accounting"
    );

    // TASK 2 & 3: TRANSFORM AND INTEGRATE

    // Use SIS as the primary source
    const students = new Map();

    sisRecords.forEach(record => {
      const student = transformSIS(record);

      if (students.has(student.studentId)) {
        throw new Error(
          "Duplicate SIS student ID: " + student.studentId
        );
      }

      students.set(student.studentId, student);
    });

    // Join LMS using student ID
    lmsRecords.forEach(record => {
      const lms = transformLMS(record);
      const student = students.get(lms.studentId);

      if (student) {
        student.courses.push({
          courseCode: lms.courseCode,
          finalGrade: lms.finalGrade,
          completionStatus: lms.completionStatus
        });
      }
    });

    // Join Accounting using student ID
    const seenAccounting = new Set();

    accountingRecords.forEach(record => {
      const accounting = transformAccounting(record);
      const student = students.get(accounting.studentId);

      if (student) {
        if (seenAccounting.has(accounting.studentId)) {
          throw new Error(
            "Duplicate Accounting student ID: " +
            accounting.studentId
          );
        }

        seenAccounting.add(accounting.studentId);

        student.outstandingBalance = accounting.outstandingBalance;
        student.currency = accounting.currency;
      }
    });

    // TASK 4: GENERATE JSON
    jsonData = Array.from(students.values());

    output.dataset.state = "ready";
    output.textContent = JSON.stringify(jsonData, null, 2);

    downloadBtn.disabled = false;

    showMessage(
      "ETL completed successfully. " +
      jsonData.length + " student record(s) processed."
    );

  } catch (error) {
    jsonData = null;
    output.dataset.state = "error";
    output.textContent = "Error: " + error.message;
    showMessage(error.message, true);
  }
});

// Download integrated JSON
downloadBtn.addEventListener("click", () => {
  if (!jsonData) return;

  const json = JSON.stringify(jsonData, null, 2);

  const blob = new Blob([json], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "integrated_students.json";

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
});
