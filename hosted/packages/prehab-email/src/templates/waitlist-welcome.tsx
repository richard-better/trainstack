import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

export function WaitlistWelcome() {
  return (
    <Html lang="en">
      <Head>
        <style>{`
          @import url('https://api.fontshare.com/v2/css?f[]=satoshi@700,900i&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400&display=swap');
        `}</style>
      </Head>
      <Preview>You're on the Pre waitlist</Preview>
      <Body style={body}>
        <Container style={container}>
          <Heading style={logo}>
            Pre
            <span style={velocityMark} />
          </Heading>
          <Hr style={divider} />
          <Heading as="h2" style={heading}>
            You're on the list.
          </Heading>
          <Text style={text}>
            Thanks for signing up for Pre — a sport-specific prehab app for recreational athletes
            who want to stay injury-free and move better.
          </Text>
          <Text style={text}>
            We're building Pre right now and will reach out as soon as early access is ready. You'll
            be among the first to try it.
          </Text>
          <Text style={signoff}>— Rich, founder of Pre</Text>
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

const velocityMark: React.CSSProperties = {
  display: "inline-block",
  width: "6px",
  height: "4px",
  backgroundColor: "#D4603A",
  borderRadius: "1px",
  marginLeft: "1px",
  verticalAlign: "middle",
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
