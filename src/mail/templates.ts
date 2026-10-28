import type { Lang } from '../i18n/i18n.js';
import type { Mail } from './mail.service.js';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function render(
  to: string,
  subject: string,
  lines: string[],
  link?: { url: string; label: string },
): Mail {
  const text = [
    ...lines,
    ...(link ? ['', `${link.label}: ${link.url}`] : []),
  ].join('\n');
  const html = `<div style="font-family:'Noto Sans Lao','Noto Sans Thai',Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">${lines
    .map((l) => `<p>${esc(l)}</p>`)
    .join('')}${
    link
      ? `<p><a href="${esc(link.url)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">${esc(link.label)}</a></p><p style="font-size:12px;color:#666">${esc(link.url)}</p>`
      : ''
  }</div>`;
  return { to, subject, text, html };
}

const T = {
  signup: {
    lo: (code: string, company: string) => ({
      subject: `ລະຫັດຢືນຢັນ ${code} — ${company}`,
      lines: [
        `ລະຫັດຢືນຢັນການສະໝັກ ${company} ຂອງທ່ານແມ່ນ:`,
        code,
        'ລະຫັດນີ້ໃຊ້ໄດ້ 30 ນາທີ. ຖ້າທ່ານບໍ່ໄດ້ສະໝັກ, ບໍ່ຕ້ອງເຮັດຫຍັງ.',
      ],
      label: 'ຢືນຢັນອີເມວ',
    }),
    th: (code: string, company: string) => ({
      subject: `รหัสยืนยัน ${code} — ${company}`,
      lines: [
        `รหัสยืนยันการสมัคร ${company} ของคุณคือ:`,
        code,
        'รหัสนี้ใช้ได้ 30 นาที ถ้าคุณไม่ได้สมัคร ไม่ต้องทำอะไร',
      ],
      label: 'ยืนยันอีเมล',
    }),
    en: (code: string, company: string) => ({
      subject: `Verification code ${code} — ${company}`,
      lines: [
        `Your code to finish signing up ${company} is:`,
        code,
        'It is valid for 30 minutes. If you did not sign up, ignore this e-mail.',
      ],
      label: 'Verify e-mail',
    }),
  },
  verify: {
    lo: (name: string) => ({
      subject: 'ຢືນຢັນອີເມວຂອງທ່ານ',
      lines: [
        `ສະບາຍດີ ${name},`,
        'ກົດປຸ່ມລຸ່ມນີ້ເພື່ອຢືນຢັນອີເມວ (ໃຊ້ໄດ້ 3 ມື້).',
      ],
      label: 'ຢືນຢັນອີເມວ',
    }),
    th: (name: string) => ({
      subject: 'ยืนยันอีเมลของคุณ',
      lines: [
        `สวัสดี ${name}`,
        'กดปุ่มด้านล่างเพื่อยืนยันอีเมล (ใช้ได้ 3 วัน)',
      ],
      label: 'ยืนยันอีเมล',
    }),
    en: (name: string) => ({
      subject: 'Confirm your e-mail',
      lines: [
        `Hello ${name},`,
        'Press the button below to confirm your e-mail (valid for 3 days).',
      ],
      label: 'Confirm e-mail',
    }),
  },
  reset: {
    lo: (name: string) => ({
      subject: 'ຕັ້ງລະຫັດຜ່ານໃໝ່',
      lines: [
        `ສະບາຍດີ ${name},`,
        'ມີຄຳຮ້ອງຂໍຕັ້ງລະຫັດຜ່ານໃໝ່ສຳລັບບັນຊີຂອງທ່ານ. ລິ້ງນີ້ໃຊ້ໄດ້ 1 ຊົ່ວໂມງ.',
        'ຖ້າທ່ານບໍ່ໄດ້ຮ້ອງຂໍ, ບໍ່ຕ້ອງເຮັດຫຍັງ.',
      ],
      label: 'ຕັ້ງລະຫັດຜ່ານໃໝ່',
    }),
    th: (name: string) => ({
      subject: 'ตั้งรหัสผ่านใหม่',
      lines: [
        `สวัสดี ${name}`,
        'มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ ลิงก์นี้ใช้ได้ 1 ชั่วโมง',
        'ถ้าคุณไม่ได้ขอ ไม่ต้องทำอะไร',
      ],
      label: 'ตั้งรหัสผ่านใหม่',
    }),
    en: (name: string) => ({
      subject: 'Reset your password',
      lines: [
        `Hello ${name},`,
        'Someone asked to reset the password of your account. The link is valid for 1 hour.',
        'If it was not you, ignore this e-mail.',
      ],
      label: 'Reset password',
    }),
  },
  paid: {
    lo: (number: string, plan: string, until: string) => ({
      subject: `ໄດ້ຮັບເງິນແລ້ວ — ${number}`,
      lines: [
        `ຂອບໃຈ! ໄດ້ຮັບເງິນຄ່າແພັກເກດ ${plan} ຕາມໃບແຈ້ງໜີ້ ${number} ແລ້ວ.`,
        `ໃຊ້ໄດ້ຮອດ ${until}.`,
      ],
    }),
    th: (number: string, plan: string, until: string) => ({
      subject: `ได้รับชำระแล้ว — ${number}`,
      lines: [
        `ขอบคุณ! ได้รับชำระค่าแพ็กเกจ ${plan} ตามใบแจ้งหนี้ ${number} แล้ว`,
        `ใช้ได้ถึง ${until}`,
      ],
    }),
    en: (number: string, plan: string, until: string) => ({
      subject: `Payment received — ${number}`,
      lines: [
        `Thank you! We received the payment for ${plan} (invoice ${number}).`,
        `Your plan runs until ${until}.`,
      ],
    }),
  },
};

export const mailTemplates = {
  signupCode(
    lang: Lang,
    to: string,
    code: string,
    company: string,
    url: string,
  ) {
    const t = T.signup[lang](code, company);
    return render(to, t.subject, t.lines, { url, label: t.label });
  },
  verifyEmail(lang: Lang, to: string, name: string, url: string) {
    const t = T.verify[lang](name);
    return render(to, t.subject, t.lines, { url, label: t.label });
  },
  resetPassword(lang: Lang, to: string, name: string, url: string) {
    const t = T.reset[lang](name);
    return render(to, t.subject, t.lines, { url, label: t.label });
  },
  invoicePaid(
    lang: Lang,
    to: string,
    number: string,
    plan: string,
    until: string,
  ) {
    const t = T.paid[lang](number, plan, until);
    return render(to, t.subject, t.lines);
  },
};
