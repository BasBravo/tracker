/**
 * Declaración de tipos para nodemailer (fallback si @types/nodemailer no está instalado).
 */
declare module "nodemailer" {
  export interface Transporter extends NodeJS.EventEmitter {
    sendMail(mailOptions: unknown): Promise<{ messageId?: string }>;
    close(): void;
  }

  export function createTransport(options?: unknown): Transporter;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
