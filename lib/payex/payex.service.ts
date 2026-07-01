export interface PayexTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface CreatePaymentIntentParams {
  amount: number;
  collectionId: string;
  customerName: string;
  email: string;
  contactNumber: string;
  address: string;
  nonce: string;
  referenceNumber: string;
  returnUrl: string;
  acceptUrl: string;
  rejectUrl: string;
  callbackUrl: string;
  expiryDate: string;
  splitAccount?: string;
}

export async function getTokenData(token: string): Promise<PayexTokenResponse> {
  const baseUrl = process.env.PAYEX_API_BASE_URL;
  if (!baseUrl) throw new Error("PAYEX_API_BASE_URL is not set");

  const res = await fetch(`${baseUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayEx getTokenData failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<PayexTokenResponse>;
}

export async function createPaymentIntentURL(
  accessToken: string,
  params: CreatePaymentIntentParams
): Promise<string> {
  const baseUrl = process.env.PAYEX_API_BASE_URL;
  if (!baseUrl) throw new Error("PAYEX_API_BASE_URL is not set");

  const payload = {
    amount: params.amount,
    collection_id: params.collectionId,
    customer_name: params.customerName,
    email: params.email,
    contact_number: params.contactNumber,
    address: params.address,
    nonce: params.nonce,
    reference_number: params.referenceNumber,
    return_url: params.returnUrl,
    accept_url: params.acceptUrl,
    reject_url: params.rejectUrl,
    callback_url: params.callbackUrl,
    expiry_date: params.expiryDate,
    ...(params.splitAccount ? { split_account: params.splitAccount } : {}),
  };

  const res = await fetch(`${baseUrl}/payment-intent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PayEx createPaymentIntentURL failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { result: Array<{ url: string }> };
  const url = data?.result?.[0]?.url;
  if (!url) throw new Error("PayEx response missing result[0].url");
  return url;
}
