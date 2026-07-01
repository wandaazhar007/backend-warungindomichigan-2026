import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

interface OrderItem {
  productName: string;
  quantity: number;
  unitPrice: string | number;
  subtotal: string | number;
}

interface OrderEmailData {
  orderNumber: string;
  firstName: string;
  email: string;
  items: OrderItem[];
  subtotal: string | number;
  shippingCost: string | number;
  tax: string | number;
  total: string | number;
  shipFirstName: string;
  shipLastName: string;
  shipStreet1: string;
  shipStreet2?: string | null;
  shipCity: string;
  shipState: string;
  shipZip: string;
  shippingCarrier?: string | null;
  shippingService?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
}

function formatUSD(amount: string | number): string {
  return `$${parseFloat(amount.toString()).toFixed(2)}`;
}

function buildConfirmationEmailHtml(order: OrderEmailData): string {
  const itemRows = order.items
    .map(
      (item) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #E4E4E7;">${item.productName}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E4E4E7;text-align:center;">${item.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E4E4E7;text-align:right;">${formatUSD(item.subtotal)}</td>
      </tr>`
    )
    .join('');

  const street2Row = order.shipStreet2
    ? `<br>${order.shipStreet2}`
    : '';

  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:'DM Sans',Arial,sans-serif;color:#18181B;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E4E4E7;">

        <!-- Header -->
        <tr>
          <td style="background:#E86363;padding:32px;text-align:center;">
            <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;">Warung IndoMi</h1>
            <p style="margin:8px 0 0;color:#FFE8E8;font-size:14px;">Taste of Home, Wherever You Are</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;">Halo ${order.firstName},</p>
            <p style="margin:0 0 24px;color:#71717A;">Terima kasih sudah berbelanja di Warung IndoMi! Pesananmu telah kami terima dan sedang kami proses.</p>

            <!-- Order number badge -->
            <div style="background:#FFF5F5;border:1px solid #FFCCCC;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
              <p style="margin:0;font-size:13px;color:#D14F4F;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Nomor Pesanan</p>
              <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:#18181B;">${order.orderNumber}</p>
            </div>

            <!-- Items table -->
            <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;">Detail Pesanan</h3>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <thead>
                <tr style="background:#F4F4F5;">
                  <th style="padding:8px;text-align:left;font-size:13px;color:#71717A;font-weight:500;">Produk</th>
                  <th style="padding:8px;text-align:center;font-size:13px;color:#71717A;font-weight:500;">Qty</th>
                  <th style="padding:8px;text-align:right;font-size:13px;color:#71717A;font-weight:500;">Total</th>
                </tr>
              </thead>
              <tbody>${itemRows}</tbody>
            </table>

            <!-- Totals -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="padding:4px 0;color:#71717A;font-size:14px;">Subtotal</td>
                <td style="padding:4px 0;text-align:right;font-size:14px;">${formatUSD(order.subtotal)}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#71717A;font-size:14px;">Ongkos Kirim</td>
                <td style="padding:4px 0;text-align:right;font-size:14px;">${formatUSD(order.shippingCost)}</td>
              </tr>
              ${parseFloat(order.tax.toString()) > 0 ? `
              <tr>
                <td style="padding:4px 0;color:#71717A;font-size:14px;">Pajak</td>
                <td style="padding:4px 0;text-align:right;font-size:14px;">${formatUSD(order.tax)}</td>
              </tr>` : ''}
              <tr style="border-top:2px solid #E4E4E7;">
                <td style="padding:10px 0 4px;font-weight:700;font-size:16px;">Total</td>
                <td style="padding:10px 0 4px;text-align:right;font-weight:700;font-size:16px;color:#E86363;">${formatUSD(order.total)}</td>
              </tr>
            </table>

            <!-- Shipping address -->
            <h3 style="margin:0 0 8px;font-size:15px;font-weight:600;">Dikirim ke</h3>
            <p style="margin:0 0 24px;color:#3F3F46;font-size:14px;line-height:1.6;">
              ${order.shipFirstName} ${order.shipLastName}<br>
              ${order.shipStreet1}${street2Row}<br>
              ${order.shipCity}, ${order.shipState} ${order.shipZip}
            </p>

            ${order.shippingCarrier ? `
            <h3 style="margin:0 0 8px;font-size:15px;font-weight:600;">Metode Pengiriman</h3>
            <p style="margin:0 0 24px;color:#3F3F46;font-size:14px;">${order.shippingCarrier} — ${order.shippingService ?? ''}</p>
            ` : ''}

            <!-- Processing note -->
            <div style="background:#F4F4F5;border-radius:8px;padding:16px;margin-bottom:24px;">
              <p style="margin:0;font-size:14px;color:#3F3F46;line-height:1.6;">
                Pesananmu akan diproses dalam 1–2 hari kerja. Kamu akan mendapat email lagi saat pesanan dikirim beserta nomor tracking.
              </p>
            </div>

            <p style="margin:0 0 4px;font-size:14px;color:#71717A;">Ada pertanyaan? Hubungi kami via WhatsApp di <strong>+1 (626) 461-4963</strong></p>
            <p style="margin:0;font-size:14px;color:#71717A;">atau balas email ini.</p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F4F4F5;padding:24px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#71717A;">Salam hangat,</p>
            <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#3F3F46;">Tim Warung IndoMi</p>
            <p style="margin:16px 0 0;font-size:12px;color:#A1A1AA;">© 2026 Warung IndoMi. All rights reserved.<br>Built with ❤️ in Michigan, USA</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildShippedEmailHtml(order: OrderEmailData): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:'DM Sans',Arial,sans-serif;color:#18181B;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E4E4E7;">
        <tr>
          <td style="background:#E86363;padding:32px;text-align:center;">
            <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;">Warung IndoMi</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;font-size:20px;">Pesanan #${order.orderNumber} Sudah Dikirim! 🚚</h2>
            <p style="margin:0 0 24px;color:#71717A;">Halo ${order.firstName}, yeay! Pesananmu sudah dalam perjalanan.</p>

            ${order.trackingNumber ? `
            <div style="background:#FFF5F5;border:1px solid #FFCCCC;border-radius:8px;padding:20px;margin-bottom:24px;">
              <p style="margin:0 0 4px;font-size:13px;color:#D14F4F;font-weight:600;">Kurir</p>
              <p style="margin:0 0 16px;font-size:15px;font-weight:600;">${order.shippingCarrier} — ${order.shippingService ?? ''}</p>
              <p style="margin:0 0 4px;font-size:13px;color:#D14F4F;font-weight:600;">Nomor Resi</p>
              <p style="margin:0 0 16px;font-size:18px;font-weight:700;letter-spacing:1px;">${order.trackingNumber}</p>
              ${order.trackingUrl ? `
              <a href="${order.trackingUrl}" style="display:inline-block;background:#E86363;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:6px;font-weight:600;font-size:14px;">Lacak Paketmu →</a>
              ` : ''}
            </div>
            ` : ''}

            <p style="margin:0;font-size:14px;color:#71717A;">Semoga produk Indonesia favoritmu segera sampai dengan selamat!</p>
          </td>
        </tr>
        <tr>
          <td style="background:#F4F4F5;padding:24px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#71717A;">Salam hangat,</p>
            <p style="margin:4px 0 0;font-size:14px;font-weight:600;">Tim Warung IndoMi</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendOrderConfirmationEmail(order: OrderEmailData): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
    to: order.email,
    subject: `Pesanan #${order.orderNumber} Berhasil Diterima — Warung IndoMi`,
    html: buildConfirmationEmailHtml(order),
  });
}

export async function sendOrderShippedEmail(order: OrderEmailData): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
    to: order.email,
    subject: `Pesanan #${order.orderNumber} Sudah Dikirim! 🚚`,
    html: buildShippedEmailHtml(order),
  });
}

function buildPaymentFailedEmailHtml(orderNumber: string, firstName: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:'DM Sans',Arial,sans-serif;color:#18181B;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E4E4E7;">

        <tr>
          <td style="background:#E86363;padding:32px;text-align:center;">
            <h1 style="margin:0;color:#FFFFFF;font-size:24px;font-weight:700;">Warung IndoMi</h1>
            <p style="margin:8px 0 0;color:#FFE8E8;font-size:14px;">Taste of Home, Wherever You Are</p>
          </td>
        </tr>

        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 8px;font-size:16px;">Halo ${firstName},</p>
            <p style="margin:0 0 24px;color:#71717A;">Kami ingin memberitahu bahwa pembayaran untuk pesanan <strong>#${orderNumber}</strong> tidak berhasil diproses.</p>

            <div style="background:#FFF5F5;border:1px solid #FFCCCC;border-radius:8px;padding:20px;margin-bottom:24px;">
              <p style="margin:0 0 8px;font-weight:600;font-size:15px;color:#D14F4F;">⚠️ Pembayaran Gagal</p>
              <p style="margin:0;font-size:14px;color:#3F3F46;line-height:1.6;">
                Pesanan <strong>#${orderNumber}</strong> telah dibatalkan karena pembayaran tidak berhasil.<br><br>
                Kemungkinan penyebab: kartu tidak memiliki dana yang cukup, kartu ditolak bank, atau koneksi terputus saat checkout.
              </p>
            </div>

            <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;">Ingin mencoba lagi?</h3>
            <p style="margin:0 0 16px;font-size:14px;color:#71717A;line-height:1.6;">
              Produk favoritmu masih tersedia! Silakan buat pesanan baru di toko kami.
            </p>
            <a href="${process.env.CLIENT_URL ?? 'https://warungindomichigan.com'}/products"
               style="display:inline-block;background:#E86363;color:#FFFFFF;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
              Belanja Lagi →
            </a>

            <p style="margin:24px 0 4px;font-size:14px;color:#71717A;">Ada pertanyaan? Hubungi kami via WhatsApp di <strong>+1 (626) 461-4963</strong></p>
            <p style="margin:0;font-size:14px;color:#71717A;">atau balas email ini.</p>
          </td>
        </tr>

        <tr>
          <td style="background:#F4F4F5;padding:24px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#71717A;">Salam hangat,</p>
            <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#3F3F46;">Tim Warung IndoMi</p>
            <p style="margin:16px 0 0;font-size:12px;color:#A1A1AA;">© 2026 Warung IndoMi. All rights reserved.</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendPaymentFailedEmail(
  email: string,
  orderNumber: string,
  firstName: string,
): Promise<void> {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev',
    to: email,
    subject: `Pembayaran Gagal — Pesanan #${orderNumber}`,
    html: buildPaymentFailedEmailHtml(orderNumber, firstName),
  });
}
