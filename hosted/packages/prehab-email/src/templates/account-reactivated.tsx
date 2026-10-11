import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export interface AccountReactivatedProps {
  name: string;
}

export function AccountReactivated({ name }: AccountReactivatedProps) {
  const greetingName = name?.trim()?.split(" ")[0];
  return (
    <Html lang="en">
      <Head>
        <style>{`
          @import url('https://api.fontshare.com/v2/css?f[]=satoshi@700,900i&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400&display=swap');
        `}</style>
      </Head>
      <Preview>Your Pre account is back</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={logo}>Pre</Heading>
          <Hr style={divider} />
          <Heading as="h2" style={heading}>
            Welcome back — your account is active
          </Heading>
          <Text style={text}>{greetingName ? `Hi ${greetingName},` : "Hi there,"}</Text>
          <Text style={text}>
            You signed back in, so we've cancelled the scheduled deletion of your Pre account.
            Nothing was removed — your profile, sessions, and check-ins are all still here.
          </Text>
          <Text style={text}>
            If you didn't do this, your account may have been accessed by someone else. Reply to
            this email and we'll help you secure it.
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
