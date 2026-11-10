/**
 * Signora - PDF Stamping and Audit Certificate Generator
 * Stamps signatures at exact box coordinates and appends an Audit Trail page.
 */
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node stamp_pdf.js <payload_json_path>');
    process.exit(1);
  }

  const payloadPath = args[0];
  const payloadRaw = fs.readFileSync(payloadPath, 'utf8');
  const payload = JSON.parse(payloadRaw);

  const {
    originalPdfPath,
    outputPdfPath,
    boxes = [],
    auditLogs = [],
    docTitle = 'Document',
    documentId = '',
    completedAt = new Date().toISOString()
  } = payload;

  if (!fs.existsSync(originalPdfPath)) {
    console.error(`Input file not found: ${originalPdfPath}`);
    process.exit(1);
  }

  const pdfBytes = fs.readFileSync(originalPdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // 1. Stamp each signature box onto its respective page
  for (const box of boxes) {
    const pageIdx = (box.page || 1) - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const { width: pWidth, height: pHeight } = page.getSize();

    // Box dimensions in percentages
    const boxW = Math.max(20, (box.width / 100) * pWidth);
    const boxH = Math.max(15, (box.height / 100) * pHeight);
    const boxX = (box.x / 100) * pWidth;
    // PDF origin (0,0) is bottom-left; web is top-left
    const boxY = pHeight - ((box.y + box.height) / 100) * pHeight;

    if (box.signatureData && box.signatureData.startsWith('data:image')) {
      try {
        const base64Data = box.signatureData.split(',')[1];
        const imgBuffer = Buffer.from(base64Data, 'base64');
        let img;
        if (box.signatureData.includes('image/jpeg') || box.signatureData.includes('image/jpg')) {
          img = await pdfDoc.embedJpg(imgBuffer);
        } else {
          img = await pdfDoc.embedPng(imgBuffer);
        }

        page.drawImage(img, {
          x: boxX,
          y: boxY,
          width: boxW,
          height: boxH,
        });

        // Small neat signer label
        const signerLabel = box.signerName ? `Digitally signed by ${box.signerName}` : 'Digitally signed';
        page.drawText(signerLabel, {
          x: boxX,
          y: Math.max(2, boxY - 9),
          size: 7,
          font: fontRegular,
          color: rgb(0.25, 0.25, 0.35),
        });
      } catch (err) {
        console.error('Error stamping signature image:', err);
      }
    }
  }

  // 2. Append Audit Trail & Certificate of Completion page
  const auditPage = pdfDoc.addPage([595.28, 841.89]); // Standard A4 portrait
  const { width: aWidth, height: aHeight } = auditPage.getSize();

  // Background banner
  auditPage.drawRectangle({
    x: 0,
    y: aHeight - 90,
    width: aWidth,
    height: 90,
    color: rgb(0.31, 0.27, 0.90), // #4f46e5 Indigo
  });

  auditPage.drawText('SIGNORA', {
    x: 36,
    y: aHeight - 45,
    size: 20,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  auditPage.drawText('Certificate of Completion & Audit Trail', {
    x: 36,
    y: aHeight - 68,
    size: 13,
    font: fontRegular,
    color: rgb(0.9, 0.9, 0.98),
  });

  let currentY = aHeight - 125;

  // Document Summary Box
  auditPage.drawRectangle({
    x: 36,
    y: currentY - 70,
    width: aWidth - 72,
    height: 85,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.94),
    borderWidth: 1,
  });

  auditPage.drawText('DOCUMENT SUMMARY', {
    x: 48,
    y: currentY,
    size: 9,
    font: fontBold,
    color: rgb(0.31, 0.27, 0.90),
  });

  auditPage.drawText(`Title: ${docTitle}`, {
    x: 48,
    y: currentY - 18,
    size: 10,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.15),
  });

  auditPage.drawText(`Document ID: ${documentId}`, {
    x: 48,
    y: currentY - 34,
    size: 8,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.55),
  });

  auditPage.drawText(`Completed Date: ${new Date(completedAt).toUTCString()}`, {
    x: 48,
    y: currentY - 50,
    size: 8,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.55),
  });

  currentY -= 95;

  // Signers Section
  auditPage.drawText('SIGNATURE DETAILS', {
    x: 36,
    y: currentY,
    size: 11,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.15),
  });
  currentY -= 15;

  const uniqueSigners = [];
  const seenEmails = new Set();
  for (const b of boxes) {
    if (b.signerEmail && !seenEmails.has(b.signerEmail)) {
      seenEmails.add(b.signerEmail);
      uniqueSigners.push(b);
    }
  }

  if (uniqueSigners.length === 0) {
    auditPage.drawText('All required signers completed signatures.', {
      x: 36,
      y: currentY,
      size: 9,
      font: fontRegular,
      color: rgb(0.3, 0.3, 0.3),
    });
    currentY -= 18;
  } else {
    for (const signer of uniqueSigners) {
      auditPage.drawRectangle({
        x: 36,
        y: currentY - 45,
        width: aWidth - 72,
        height: 52,
        color: rgb(0.98, 0.99, 1.0),
        borderColor: rgb(0.88, 0.90, 0.95),
        borderWidth: 1,
      });

      auditPage.drawText(`Signer: ${signer.signerName || 'Signer'} (${signer.signerEmail || ''})`, {
        x: 48,
        y: currentY - 12,
        size: 9,
        font: fontBold,
        color: rgb(0.1, 0.1, 0.15),
      });

      auditPage.drawText(`Status: SIGNED`, {
        x: 48,
        y: currentY - 26,
        size: 8,
        font: fontBold,
        color: rgb(0.1, 0.5, 0.2), // Green
      });

      currentY -= 60;
    }
  }

  currentY -= 10;

  // Audit Activity Log Timeline
  auditPage.drawText('AUDIT LOG TIMELINE', {
    x: 36,
    y: currentY,
    size: 11,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.15),
  });
  currentY -= 16;

  // Table header
  auditPage.drawText('Timestamp (UTC)', { x: 36, y: currentY, size: 8, font: fontBold, color: rgb(0.35, 0.4, 0.5) });
  auditPage.drawText('Action', { x: 160, y: currentY, size: 8, font: fontBold, color: rgb(0.35, 0.4, 0.5) });
  auditPage.drawText('Performed By', { x: 270, y: currentY, size: 8, font: fontBold, color: rgb(0.35, 0.4, 0.5) });
  auditPage.drawText('Details', { x: 410, y: currentY, size: 8, font: fontBold, color: rgb(0.35, 0.4, 0.5) });
  currentY -= 8;

  auditPage.drawLine({
    start: { x: 36, y: currentY },
    end: { x: aWidth - 36, y: currentY },
    thickness: 0.5,
    color: rgb(0.8, 0.82, 0.88),
  });
  currentY -= 14;

  for (const log of auditLogs) {
    if (currentY < 50) break; // page boundary protection

    const timeStr = log.createdAt ? new Date(log.createdAt).toISOString().replace('T', ' ').substring(0, 19) : '';
    const actionStr = String(log.action || '').toUpperCase();
    const byStr = String(log.performedBy || '').substring(0, 24);
    const detailsStr = String(log.details || '').substring(0, 30);

    auditPage.drawText(timeStr, { x: 36, y: currentY, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    auditPage.drawText(actionStr, { x: 160, y: currentY, size: 7.5, font: fontBold, color: rgb(0.31, 0.27, 0.90) });
    auditPage.drawText(byStr, { x: 270, y: currentY, size: 7.5, font: fontRegular, color: rgb(0.2, 0.2, 0.2) });
    auditPage.drawText(detailsStr, { x: 410, y: currentY, size: 7.5, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });

    currentY -= 15;
  }

  // Footer
  auditPage.drawText('Secured & verified by Signora Electronic Document Signing System.', {
    x: 36,
    y: 25,
    size: 7,
    font: fontRegular,
    color: rgb(0.55, 0.6, 0.7),
  });

  const modifiedPdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPdfPath, modifiedPdfBytes);
  console.log(`Successfully generated signed PDF at: ${outputPdfPath}`);
}

main().catch((err) => {
  console.error('Fatal error during PDF stamping:', err);
  process.exit(1);
});

