import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Thin wrapper around Nodemailer/SMTP. Falls back to maildev (localhost:1025, an
 * inspectable local catcher at http://localhost:1080) whenever SMTP_USER is unset;
 * this deployment has real Gmail SMTP credentials configured in .env, so mail
 * actually leaves the machine. Swapping providers again later is an env-var change
 * only — nothing above this service knows or cares which transport is behind it.
 * Pattern copied from the sister feedback system.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    this.from = process.env.MAIL_FROM ?? "ASTU Lab Resources <no-reply@university.local>";
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "localhost",
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.SMTP_SECURE === "true",
      // maildev takes unauthenticated connections, so auth is only attached once
      // SMTP_USER/SMTP_PASS are actually set — a real provider (Gmail, Office365, …)
      // needs it, undefined here would make nodemailer attempt AUTH with an empty
      // credential and fail outright.
      // Gmail app passwords are usually copied WITH spaces (e.g. "abcd efgh ijkl mnop")
      // for human readability; the actual credential has none, so they're stripped here
      // rather than trusting every .env to have already done it.
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS?.replace(/\s+/g, "") } }
        : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (err) {
      // Never let a mail failure break the calling request (e.g. a nightly sweep of
      // 200 overdue loans shouldn't 500 because SMTP hiccuped on row 47) — log and
      // move on. Callers send SEQUENTIALLY (never Promise.all) for the same reason —
      // see plan edge case 57.
      this.logger.error(`Failed to send mail to ${message.to}: ${(err as Error).message}`);
    }
  }
}
