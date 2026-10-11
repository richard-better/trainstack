import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export interface AccountDeletionScheduledProps {
  name: string;
  /** Human-readable date the grace window ends (formatted by the caller). */
  deletionDate: string;
}

export function AccountDeletionScheduled({ name, deletionDate }: AccountDeletionScheduledProps) {
  const greetingName = name?.trim()?.split(" ")[0];
  return (
    <Html lang="en">
      <Head>
        <style>{`
          @import url('https://api.fontshare.com/v2/css?f[]=satoshi@700,900i&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400&display=swap');
        `}</style>
      </Head>
      <Preview>Your Pre account is scheduled for deletion</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={logo}>Pre</Heading>
          <Hr style={divider} />
          <Heading as="h2" style={heading}>
            Your account is scheduled for deletion
          </Heading>
          <Text style={text}>{greetingName ? `Hi ${greetingName},` : "Hi there,"}</Text>
          <Text style={text}>
            We've scheduled your Pre account for deletion on <strong>{deletionDate}</strong>. Your
            profile, sessions, and check-ins will be permanently removed after that date.
          </Text>
          <Text style={text}>
            Changed your mind? Just open Pre and sign in any time before {deletionDate} — that
            cancels the deletion and restores everything. No further action needed.
          </Text>
          <Text style={text}>
            One thing we can't do for you: if you have an active subscription, cancel it yourself in
            the App Store (Settings → your name → Subscriptions). Deleting your account does not
            stop App Store billing.
          </Text>
          <Text style={signoff}>— The Pre team</Text>
          <Hr style={divider} />
          <Text style={footer}>Pre by TrainStack · updates.trainstackhq.com</Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#F5EFE0",
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  padding: "40px 20px",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "16px",
  maxWidth: "520px",
  margin: "0 auto",
  padding: "40px 32px",
};

const logo: React.CSSProperties = {
  fontFamily: "'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif",
  fontWeight: 900,
  fontStyle: "italic",
  fontSize: "28px",
  lineHeight: "1",
  color: "#1A2530",
  margin: "0 0 24px 0",
};

const divider: React.CSSProperties = {
  borderColor: "rgba(0,0,0,0.08)",
  margin: "24px 0",
};

const heading: React.CSSProperties = {
  fontFamily: "'Satoshi', -apple-system, BlinkMacSystemFont, sans-serif",
  fontWeight: 700,
  fontSize: "22px",
  lineHeight: "1.3",
  color: "#1A2530",
  margin: "0 0 16px 0",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  lineHeight: "1.65",
  color: "#1A2530",
  margin: "0 0 16px 0",
};

const signoff: React.CSSProperties = {
  ...text,
  color: "#8B7D6B",
  margin: "24px 0 0 0",
};

const footer: React.CSSProperties = {
  fontSize: "13px",
  lineHeight: "1.5",
  color: "#8B7D6B",
  textAlign: "center" as const,
  margin: "0",
};
