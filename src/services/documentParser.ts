import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

export interface ExtractedDocumentResult {
  fileType: 'pdf' | 'txt' | 'docx';
  extractedText: string;
}

export async function extractDocumentText(file: File): Promise<ExtractedDocumentResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File exceeds the 15 MB browser limit.');
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.txt') || file.type === 'text/plain') {
    const text = (await file.text()).trim();
    if (!text) throw new Error('Text file contains no readable characters.');
    return { fileType: 'txt', extractedText: text };
  }

  if (lower.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = result.value.trim();
    if (!text) throw new Error('DOCX file contains no readable text.');
    return { fileType: 'docx', extractedText: text };
  }

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    const buffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const pages: string[] = [];

    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean);
      pages.push(strings.join(' '));
    }

    const text = pages.join('\n\n').trim();
    if (!text) {
      throw new Error('No extractable text found in PDF (scanned image PDFs are not OCR-supported offline).');
    }
    return { fileType: 'pdf', extractedText: text };
  }

  throw new Error('Unsupported file format. Upload a .pdf, .txt, or .docx file.');
}
