// lib/invoice/mailer.ts
//
// Email delivery abstraction for the bulk-invoice run.
//
// Default (zero-credential) mode uses Ethereal — Nodemailer's built-in fake
// SMTP service. It creates a throwaway test inbox on the fly, CAPTURES each
// message (nothing is delivered to real recipients), and returns a public
// preview URL so the rendered invoice email + PDF can be viewed in a demo.
//
// To deliver real email instead, configure a generic SMTP provider via the
// SMTP_* environment variables (e.g. Resend, Amazon SES, or Gmail SMTP); the
// same code path then sends for real with no preview URL.
import nodemailer, { Transporter } from "nodemailer";

export interface MailTransport {
  transporter: Transporter;
  isEthereal: boolean;
  from: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  attachmentFilename: string;
  pdfBytes: Uint8Array;
}

/**
 * Builds a transporter for the current run. Reuse one per invocation (it is
 * shared across a chunk's subscribers) rather than creating one per email.
 */
export async function createMailTransport(): Promise<MailTransport> {
  // Real delivery when a generic SMTP provider is configured.
  if (process.env.SMTP_HOST) {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    return {
      transporter,
      isEthereal: false,
      from: process.env.SMTP_FROM ?? "SOLS Energy <no-reply@solsenergy.com>",
    };
  }

  // Zero-credential demo default: an ephemeral Ethereal capture inbox.
  const account = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
  return {
    transporter,
    isEthereal: true,
    from: "SOLS Energy (Demo) <no-reply@ethereal.email>",
  };
}

/**
 * Sends one invoice email with the PDF attached. Returns the message id and, in
 * Ethereal mode, a public preview URL where the message can be viewed.
 */
export async function sendInvoiceEmail(
  mt: MailTransport,
  params: SendEmailParams
): Promise<{ id: string; previewUrl: string | null }> {
  const info = await mt.transporter.sendMail({
    from: mt.from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    attachments: [
      {
        filename: params.attachmentFilename,
        content: Buffer.from(params.pdfBytes),
        contentType: "application/pdf",
      },
    ],
  });

  const previewUrl = mt.isEthereal
    ? (nodemailer.getTestMessageUrl(info) || null)
    : null;

  return { id: info.messageId, previewUrl };
}
