export interface PaymentReminderTemplateParams {
  customerName?: string;
}

export const PAYMENT_REMINDER_SUBJECT = "Payment Reminder: Invoice Due Date Approaching";

function getCurrentMonthName(): string {
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date());
}

export function buildPaymentReminderHtml(params: PaymentReminderTemplateParams): string {
  const monthName = getCurrentMonthName();

  return `
    <p>Dear Sir/Madam,</p>
    <p>I hope this email finds you well.</p>
    <p>
      We would like to follow up on the ${monthName} invoice previously shared with you, which is approaching its due date.
      Kindly let us know if there are any questions or clarifications required on the invoice. For your kind reference the link of the payment is provided in the previous email sent.
    </p>
    <p>
      We would appreciate it if you could advise on the payment status or the expected payment date at your earliest convenience.
    </p>
    <p>Please kindly disregard this email if payment has already been made.</p>
    <p>Thank you for your attention, and we look forward to your response.</p>
    <p style="margin-bottom: 0; color: #111111; font-weight: 400;">With respect,</p>
  `;
}

export function buildPaymentReminderText(params: PaymentReminderTemplateParams): string {
  const monthName = getCurrentMonthName();

  return `Dear Sir/Madam,

I hope this email finds you well.
We would like to follow up on the ${monthName} invoice previously shared with you, which is approaching its due date. Kindly let us know if there are any questions or clarifications required on the invoice. For your kind reference the link of the payment is provided in the previous email sent.
We would appreciate it if you could advise on the payment status or the expected payment date at your earliest convenience.
Please kindly disregard this email if payment has already been made.
Thank you for your attention, and we look forward to your response.

With respect,`;
}
