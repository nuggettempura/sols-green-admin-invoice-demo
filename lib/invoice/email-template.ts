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
  const { customerName, invoiceNumber, billingPeriod, totalAmount, dueDate, paymentURL } = params;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Invoice from SOLS Energy</title></head>
<body style="font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 20px;">
  <div style="max-width: 600px; margin: auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="background: #0a5cbf; padding: 24px 32px;">
      <h1 style="color: white; margin: 0; font-size: 22px;">SOLS Energy</h1>
      <p style="color: #cce0ff; margin: 4px 0 0; font-size: 13px;">Monthly Home Solar Subscription Invoice</p>
    </div>
    <div style="padding: 32px;">
      <p style="color: #333; font-size: 15px;">Dear <strong>${customerName}</strong>,</p>
      <p style="color: #555; font-size: 14px;">
        Please find your invoice for your Home Solar Subscription below.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 24px 0; font-size: 14px;">
        <tr style="background: #f0f4ff;">
          <td style="padding: 10px 14px; font-weight: bold; color: #555; width: 40%;">Invoice Number</td>
          <td style="padding: 10px 14px; color: #111;">${invoiceNumber}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: bold; color: #555;">Billing Period</td>
          <td style="padding: 10px 14px; color: #111;">${billingPeriod}</td>
        </tr>
        <tr style="background: #f0f4ff;">
          <td style="padding: 10px 14px; font-weight: bold; color: #555;">Amount Due</td>
          <td style="padding: 10px 14px; color: #111; font-size: 16px; font-weight: bold;">${totalAmount}</td>
        </tr>
        <tr>
          <td style="padding: 10px 14px; font-weight: bold; color: #555;">Due Date</td>
          <td style="padding: 10px 14px; color: #c0392b;">${dueDate}</td>
        </tr>
      </table>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${paymentURL}"
           style="display: inline-block; background: #0a5cbf; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 15px; font-weight: bold;">
          Pay Now
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 12px;">
          Or copy this link: <a href="${paymentURL}" style="color: #0a5cbf;">${paymentURL}</a>
        </p>
      </div>
      <p style="color: #888; font-size: 12px; margin-top: 24px; border-top: 1px solid #eee; padding-top: 16px;">
        The invoice PDF is attached to this email. If you have questions, please contact support@sols247.org.
      </p>
    </div>
  </div>
</body>
</html>`;
}
