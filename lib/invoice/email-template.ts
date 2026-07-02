// lib/invoice/email-template.ts

export interface InvoiceEmailParams {
  customerName: string;
  invoiceNumber: string;
  billingPeriod: string;
  totalAmount: string;
  dueDate: string;
  paymentURL: string;
}

export function buildInvoiceEmailHtml(params: InvoiceEmailParams): string {
  const { customerName, invoiceNumber, billingPeriod, paymentURL } = params;

  const paymentBlock = paymentURL
    ? `<div style="margin: 24px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid #28a745;">
  <p style="margin: 0 0 12px 0; font-weight: bold; color: #333;">Pay Your Invoice Online</p>
  <p style="margin: 0 0 16px 0; color: #666;">Click the button below to make a secure payment:</p>
  <a href="${paymentURL}" target="_blank" style="display: inline-block; padding: 12px 24px; background-color: #28a745; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">Pay Now</a>
  <p style="margin: 16px 0 0 0; font-size: 12px; color: #888;">Or copy this link: <a href="${paymentURL}" style="color: #007bff; word-break: break-all;">${paymentURL}</a></p>
</div>`
    : "";

  return `<html><body style="font-family: Arial, sans-serif; font-size: 14px; color: #333; margin: 0 auto; padding: 20px;">
<p>Dear ${customerName},</p>

<p>We trust this message finds you in good health. We sincerely appreciate your ongoing commitment to sustainable energy with us. Enclosed, please find your monthly solar generation invoice <strong>${invoiceNumber}</strong> for <strong>${billingPeriod}</strong>.</p>

<p>
<strong>Important Notice:</strong><br>
Please be informed that, effective immediately, the recipient name displayed on the payment page and payment link will be changed from Gentari Suria Resi Sdn. Bhd to SOLS Green Fintech Sdn. Bhd. This is an administrative update only and does not affect your solar subscription, billing amount, or payment process. Kindly proceed with your payment as usual when you see SOLS Green Fintech Sdn Bhd as the payment recipient.
</p>

${paymentBlock}

<p>Once you are on the secure payment page, kindly follow the steps below:</p>
<ol>
  <li>Click on the designated blue box.</li>
  <li>Select your preferred bank type and then choose your bank.</li>
  <li>Proceed to complete your payment.</li>
</ol>

<p>For any inquiries or assistance regarding your invoice or solar generation, our dedicated customer support team is at your service. Reach out to us via email at <strong>support@solsenergy.com</strong> or through WhatsApp at <strong>+60183555247</strong>.</p>
<p>We appreciate your cooperation in this matter. Together, we are making a significant positive impact on the environment.</p>
<p>Thank you for choosing sustainable energy.</p>
<p style="margin-bottom: 0;">Regards,</p>
<p style="margin-top: 0; margin-bottom: 0;">Billing Team</p>
<p style="margin-top: 0;">SOLS Green Fintech</p>
</body></html>`;
}
