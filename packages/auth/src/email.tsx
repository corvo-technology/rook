/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@corvo/adapter-kit";
import { displayName } from "@corvo/core";
import { lightTokens } from "@corvo/ui-tokens";
import type { CSSProperties, ReactNode } from "react";
import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Html,
  Img,
  Row,
  render,
  Section,
  Text,
  toPlainText,
} from "react-email";

// Mirrors the landing page (apps/www). Mail clients drop alpha and CSS variables, so these are
// opaque hex values; everything else comes from the shared tokens.
const brand = {
  line: "#ECECEC",
  body: "#3D3D3D",
  muted: "#6B6B6B",
  mint: "#0B7A5A",
  mintSoft: "#E8F8F2",
  mintLine: "#BFE8D8",
};
const sans = '"Instrument Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';

const text: CSSProperties = { margin: "0 0 16px", fontSize: "16px", lineHeight: "24px" };
const note: CSSProperties = {
  margin: 0,
  fontSize: "14px",
  lineHeight: "22px",
  color: brand.muted,
};

async function message(
  webOrigin: string,
  to: string,
  subject: string,
  content: ReactNode,
): Promise<TransactionalEmail> {
  const html = await render(
    <Html lang="en">
      <Head />
      <Body
        style={{
          margin: 0,
          backgroundColor: lightTokens.background,
          color: brand.body,
          fontFamily: sans,
        }}
      >
        <Container style={{ maxWidth: "480px", padding: "32px 16px" }}>
          <Row style={{ marginBottom: "20px" }}>
            <Column style={{ width: "32px" }}>
              <Img
                src={new URL("/icon-192.png", webOrigin).href}
                alt=""
                width="32"
                height="32"
                style={{ borderRadius: "9px", display: "block" }}
              />
            </Column>
            <Column style={{ paddingLeft: "9px" }}>
              <Text
                style={{
                  margin: 0,
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "-0.03em",
                  color: lightTokens.foreground,
                }}
              >
                Rook
              </Text>
            </Column>
          </Row>
          <Section
            style={{
              backgroundColor: lightTokens.dialog,
              border: `1px solid ${brand.line}`,
              borderRadius: "20px",
              padding: "28px",
            }}
          >
            {content}
          </Section>
        </Container>
      </Body>
    </Html>,
  );
  return { to, subject, html, text: toPlainText(html) };
}

function Action({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "0 0 16px" }}>
      <Button
        href={href}
        style={{
          backgroundColor: lightTokens.primary,
          color: lightTokens.primaryForeground,
          borderRadius: "14px",
          padding: "14px 22px",
          fontSize: "16px",
          fontWeight: 500,
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <Text
      style={{
        margin: "0 0 16px",
        padding: "14px 0",
        textAlign: "center",
        backgroundColor: brand.mintSoft,
        border: `1px solid ${brand.mintLine}`,
        borderRadius: "14px",
        color: brand.mint,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: "28px",
        fontWeight: 700,
        letterSpacing: "0.2em",
      }}
    >
      {children}
    </Text>
  );
}

export function verificationEmail(
  webOrigin: string,
  email: string,
  url: string,
): Promise<TransactionalEmail> {
  return message(
    webOrigin,
    email,
    "Verify your Rook email",
    <>
      <Action href={url}>Verify email</Action>
      <Text style={text}>Then return to Rook to sign in.</Text>
      <Text style={note}>
        This link expires in one hour. If you did not register, ignore this email.
      </Text>
    </>,
  );
}

export function signInCodeEmail(
  webOrigin: string,
  email: string,
  code: string,
): Promise<TransactionalEmail> {
  return message(
    webOrigin,
    email,
    "Your Rook sign-in code",
    <>
      <Text style={text}>Enter this code to sign in to Rook:</Text>
      <Code>{code}</Code>
      <Text style={note}>
        This code expires in ten minutes. If you did not request it, ignore this email.
      </Text>
    </>,
  );
}

export function passwordResetEmail(
  webOrigin: string,
  user: { id: string; email: string; name: string },
  resetUrl: string,
): Promise<TransactionalEmail> {
  return message(
    webOrigin,
    user.email,
    "Reset your Rook password",
    <>
      <Text style={text}>Hi {displayName(user.name, "there")},</Text>
      <Text style={text}>Reset your Rook password:</Text>
      <Action href={resetUrl}>Reset password</Action>
      <Text style={note}>
        This link expires in one hour. If you did not request this, you can ignore this email.
      </Text>
    </>,
  );
}

export function accountDeletionEmail(
  webOrigin: string,
  email: string,
  code: string,
): Promise<TransactionalEmail> {
  return message(
    webOrigin,
    email,
    "Confirm Rook account deletion",
    <>
      <Text style={text}>Enter this code in Rook to delete your account:</Text>
      <Code>{code}</Code>
      <Text style={note}>
        This code expires in ten minutes. If you did not request deletion, ignore this email.
      </Text>
    </>,
  );
}

export function invitationEmail(
  webOrigin: string,
  input: { to: string; inviterName: string; spaceName: string; url: string },
): Promise<TransactionalEmail> {
  return message(
    webOrigin,
    input.to,
    `${displayName(input.inviterName, "Someone")} invited you to ${displayName(input.spaceName, "a workspace")} on Rook`,
    <>
      <Text style={text}>
        {displayName(input.inviterName, "Someone")} invited you to{" "}
        {displayName(input.spaceName, "a workspace")}.
      </Text>
      <Action href={input.url}>Join</Action>
      <Text style={note}>
        This link works for seven days and only for this address. If you were not expecting it,
        ignore this email.
      </Text>
    </>,
  );
}
