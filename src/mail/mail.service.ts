import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export type Mail = { to: string; subject: string; text: string; html: string };

/**
 * Sends e-mail through SMTP (Gmail, Workspace, SES …), or writes it to the log (dev) or
 * an in-memory outbox (tests) — see MAIL_TRANSPORT.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter?: Transporter;
  /** Sent mail when MAIL_TRANSPORT=memory (newest last; capped). */
  readonly outbox: Mail[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {
    if (config.get('MAIL_TRANSPORT', { infer: true }) === 'smtp') {
      this.transporter = nodemailer.createTransport({
        host: config.get('SMTP_HOST', { infer: true }),
        port: config.get('SMTP_PORT', { infer: true }),
        secure: config.get('SMTP_SECURE', { infer: true }),
        auth: config.get('SMTP_USER', { infer: true })
          ? {
              user: config.get('SMTP_USER', { infer: true }),
              pass: config.get('SMTP_PASSWORD', { infer: true }),
            }
          : undefined,
      });
    }
  }

  async send(mail: Mail): Promise<void> {
    switch (this.config.get('MAIL_TRANSPORT', { infer: true })) {
      case 'smtp':
        await this.transporter!.sendMail({
          from: this.config.get('MAIL_FROM', { infer: true }),
          ...mail,
        });
        return;
      case 'memory':
        this.outbox.push(mail);
        if (this.outbox.length > 500) this.outbox.shift();
        return;
      default:
        this.logger.log(`Mail to ${mail.to}: ${mail.subject}\n${mail.text}`);
    }
  }

  /** Last mail sent to `to` (tests). */
  lastTo(to: string): Mail | undefined {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }

  onModuleDestroy() {
    this.transporter?.close();
  }
}
