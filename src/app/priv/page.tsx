"use client";

import { useEffect, useMemo } from "react";

/**
 * Dial Mini App — Standard Privacy Policy
 * - Tailwind optional (falls back to inline styles)
 * - Adapts to Telegram theme params when opened inside TG
 * - Shows TG BackButton and closes the webview on click
 */
export default function Page() {
  // Bind Telegram Mini App behaviors
  useEffect(() => {
    let unreg: (() => void) | undefined;
    (async () => {
      try {
        const WebApp = (await import("@twa-dev/sdk")).default;
        WebApp.ready();
        WebApp.expand();

        // Use the native back button to close the webview
        WebApp.BackButton.show();
        const handleBack = () => WebApp.close();
        WebApp.BackButton.onClick(handleBack);
        unreg = () => WebApp.BackButton.offClick(handleBack);

        // Optional: set the header color for better contrast
        if (WebApp.setHeaderColor) {
          WebApp.setHeaderColor("secondary_bg_color");
        }
      } catch {
        // no-op if running outside Telegram
      }
    })();
    return () => {
      try { unreg && unreg(); } catch {}
    };
  }, []);

  // Theme-aware styles (fallbacks if outside Telegram)
  const theme = useMemo(() => {
    const p = (typeof window !== 'undefined' && (window as any)?.Telegram?.WebApp?.themeParams) || {};
    return {
      bg: p.bg_color || "#0a0612",
      text: p.text_color || "#EDE9FE",
      subtext: p.hint_color || "#B8A6F8",
      card: p.secondary_bg_color || "#141021",
      link: p.link_color || "#7C3AED",
      separator: p.section_separator_color || "rgba(255,255,255,0.08)",
    };
  }, []);

  const containerStyle: React.CSSProperties = {
    backgroundColor: theme.bg,
    color: theme.text,
    minHeight: "100dvh",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  };

  const cardStyle: React.CSSProperties = {
    background: theme.card,
    borderRadius: 16,
    padding: 20,
    boxShadow: "0 10px 30px rgba(0,0,0,.25)",
    border: `1px solid ${theme.separator}`,
  };

  const h1Style: React.CSSProperties = {
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.2,
    margin: 0,
  };

  const h2Style: React.CSSProperties = {
    fontSize: 16,
    fontWeight: 700,
    marginTop: 20,
    marginBottom: 8,
  };

  const pStyle: React.CSSProperties = {
    color: theme.text,
    opacity: 0.95,
    lineHeight: 1.55,
    margin: "6px 0",
  };

  const smallStyle: React.CSSProperties = {
    color: theme.subtext,
    fontSize: 12,
  };

  const linkStyle: React.CSSProperties = {
    color: theme.link,
    textDecoration: "underline",
  };

  return (
    <main style={containerStyle}>
      <div
        className="max-w-2xl mx-auto px-4 py-6"
        style={{ paddingBottom: 28 }}
      >
        <header className="mb-4">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div
              aria-hidden
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background:
                  "linear-gradient(135deg, rgba(124,58,237,.25), rgba(192,38,211,.25))",
                boxShadow: "0 6px 20px rgba(124,58,237,.25)",
              }}
            />
            <div>
              <h1 style={h1Style}>Bot and Mini App Standard Privacy Policy</h1>
              <div style={smallStyle}>For Dial Mini App on Telegram</div>
            </div>
          </div>
        </header>

        <section style={cardStyle}>
          {/* 1. Terms and Definitions */}
          <h2 style={h2Style}>1. Terms and Definitions</h2>
          <p style={pStyle}>
            1.1. <strong>Telegram</strong> – Telegram Messenger Inc (also
            “we”).
          </p>
          <p style={pStyle}>
            1.2. <strong>Platform</strong> – The Telegram Bot Platform.
          </p>
          <p style={pStyle}>
            1.3. <strong>Developer</strong> – The person or legal entity who
            operates and maintains Third-Party Service, as further defined in
            3.1.
          </p>
          <p style={pStyle}>
            1.4. <strong>Third-Party Service</strong> – The bot or mini app of
            Developer, made available to users on Platform.
          </p>
          <p style={pStyle}>
            1.5. <strong>User</strong> – The person accessing Third-Party
            Service via their account on Platform (also “you”).
          </p>
          <p style={pStyle}>
            1.6. <strong>Policy</strong> – This document, governing the
            relationship between Third-Party Service and User.
          </p>

          {/* 2. General Provisions */}
          <h2 style={h2Style}>2. General Provisions</h2>
          <p style={pStyle}>
            2.1. Policy is a standard document which applies to all third-party
            bots and mini apps on Platform by default, unless or until their
            respective developer has published a separate privacy policy.
          </p>
          <p style={pStyle}>
            2.2. Policy governs solely the relationship between Developer and
            User. It cannot and does not regulate the relationship between
            Telegram and its users, nor does it supersede the Telegram Privacy
            Policy.
          </p>
          <p style={pStyle}>
            2.3 Developer follows all privacy guidelines set forth by platforms
            that distribute Telegram apps, including Apple&apos;s App Review
            Guidelines and Google&apos;s Developer Policies.
          </p>
          <p style={pStyle}>
            2.4. Policy regulates the collection, storage, distribution, usage
            and protection of information of Users who access Third-Party
            Service.
          </p>
          <p style={pStyle}>
            2.5. Your continued access to and use of Third-Party Service shall
            constitute your acceptance of Policy, the Telegram Bot Terms and the
            Telegram Mini App Terms.
          </p>
          <p style={pStyle}>
            2.6. Note that this default Policy is meant to aid Developer in
            providing a functional privacy policy to their Users, with the
            understanding that the Policy is written to be generally applicable
            to a wide range of services. Accordingly, if Developer opts to use
            the Policy, it is solely their responsibility to ensure that the
            Policy fits the Developer’s use case and complies with all local
            laws.
          </p>
          <p style={pStyle}>
            2.7. If you do not accept all the aforementioned terms, you should
            immediately cease your use of Third-Party Service.
          </p>

          {/* 3. Disclaimers */}
          <h2 style={h2Style}>3. Disclaimers</h2>
          <p style={pStyle}>
            3.1. Third-Party Service is an independent third-party application
            that is neither maintained, endorsed, nor affiliated with Telegram.
            Developer is the person or entity defined as such, for example
            within the Terms of Service of Third-Party Service, its interfaces
            or in its response to the /developer_info command.
          </p>
          <p style={pStyle}>
            3.2. You understand and agree that, without limiting section 8, this
            Policy may be amended at any time, and it is your responsibility to
            review and agree to all changes.
          </p>
          <p style={pStyle}>
            3.3. You acknowledge that you have read, understood and agreed to
            the Telegram Bot Terms and the Telegram Mini App Terms, as well as
            any other terms made available to you by Developer.
          </p>
          <p style={pStyle}>
            3.4. You acknowledge and warrant that you possess all the necessary
            rights and permissions to use Third-Party Service in compliance with
            applicable local laws and legal obligations, including without
            limitation age restrictions and third-party store terms.
          </p>
          <p style={pStyle}>
            3.5. Developer operates under the understanding that all information
            you provide is submitted in good-faith, and is not obligated to
            check or verify your statements for errors or inaccuracies. It is
            your responsibility to ensure that all information you provide is
            accurate and up-to-date.
          </p>
          <p style={pStyle}>
            3.6. You may decide to make some information available in the public
            domain, either directly on Platform, elsewhere on the internet, or
            via Third-Party Service. The information you choose to make public
            may be accessed by other users of Third-Party Service via Platform
            or on the internet, in which case it will not be covered or
            protected by Policy.
          </p>

          {/* 4. Collection of Personal Data */}
          <h2 style={h2Style}>4. Collection of Personal Data</h2>
          <p style={pStyle}>
            4.1. The ways in which Platform natively allows Third-Party Service
            to access certain limited information from and about User are
            described in the Telegram Privacy Policy and Mini App Terms.
          </p>
          <p style={pStyle}>
            4.2. Without limiting section 4.1., Third-Party Service has the
            ability to receive additional data from you if you send it messages,
            upload files to it, or choose to share personal information such as
            your contact or phone number.
          </p>
          <p style={pStyle}>
            4.3. If Third-Party Service is a mini app, it may also receive
            additional data as detailed in sections 4.1. and 4.2. of the Mini
            App Terms. In this case, Third-Party Service may also acquire
            additional information as a result of your interactions with it.
          </p>
          <p style={pStyle}>
            4.4. Third-Party Service may collect anonymous data that is not
            linked to you in any way, such as anonymized diagnostics or usage
            statistics.
          </p>

          {/* 5. Processing of Personal Data */}
          <h2 style={h2Style}>5. Processing of Personal Data</h2>
          <p style={pStyle}>
            5.1. Third-Party Service only requests, collects, processes and
            stores data that is necessary for its designated features to
            function properly. Third-Party Service processes your personal data
            on the legal ground that such processing is necessary to further its
            legitimate interests, including (i) providing services to its users;
            (ii) detecting and addressing security issues in respect of its
            provision of services; unless those interests are overridden by your
            interest or fundamental rights and freedoms that require protections
            of personal data.
          </p>
          <p style={pStyle}>
            5.2. Developer does not monetize or otherwise utilize user data for
            applications outside the scope of Third-Party Service, unless
            otherwise clearly stated by Developer and explicitly agreed to by
            User.
          </p>
          <p style={pStyle}>
            5.3. Without limiting section 6.2., private user information will
            not be transferred or made accessible to any third party, except as
            stipulated by Policy and agreed to by User.
          </p>
          <p style={pStyle}>
            5.4. In any event, Developer will only collect or otherwise
            aggregate user data in compliance with applicable laws, third-party
            store terms, and for no other purposes than those clearly stated in
            Policy and necessary to furnish and enhance the functionality of
            Third-Party Service.
          </p>

          {/* 6. Data Protection */}
          <h2 style={h2Style}>6. Data Protection</h2>
          <p style={pStyle}>
            6.1. Developer employs robust security measures to protect the
            integrity and confidentiality of all data it processes. User
            information is handled, transferred and stored in compliance with
            applicable laws, including all necessary precautions to prevent
            unauthorized access, modification, deletion, or distribution.
          </p>
          <p style={pStyle}>
            6.2. Developer will never share user data with third parties,
            including with Developer’s own additional services or bots (if any,
            as the case may be) unless explicitly authorized by User or required
            by law, such as in response to a lawful court order.
          </p>

          {/* 7. Rights and Obligations */}
          <h2 style={h2Style}>7. Rights and Obligations</h2>
          <p style={pStyle}>
            7.1. <strong>Telegram may:</strong>
            <br />
            (a) delete data sent from User to Third-Party Service from its
            servers in response to abuse of Platform by either User or
            Developer. This deletion may include sent messages, mini app cloud
            storage, the entire chat with Third-Party Service, or Third-Party
            Service itself as the case may be;
          </p>
          <p style={pStyle}>
            7.2. <strong>Developer may:</strong>
            <br />
            (a) seek verification of the identity of the User submitting data
            requests if they suspect unauthorized access to or misuse of
            personal information;
            <br />
            (b) impose reasonable limits on the number of data requests User can
            submit within a given timeframe, in order to prevent abuse of the
            request system. In any event, these limits cannot undermine User’s
            rights under applicable law;
          </p>
          <p style={pStyle}>
            7.3. <strong>Developer shall:</strong>
            <br />
            (a) comply with the stipulations set forth in Policy, or those
            outlined in any additional or substitute Policy they choose to
            enact, provided that neither can supersede the Telegram Terms of
            Service, and, by extension, the Telegram Bot Developer Terms;
            <br />
            (b) provide an easily accessible avenue for User to consult Policy,
            and for them to exercise all rights Policy entitles them to under
            applicable law;
            <br />
            (c) promptly process and respond to lawful requests from users
            within the timeframes allowed by applicable law, and, in any event,
            no later than 30 days from the date the request was submitted.
          </p>
          <p style={pStyle}>
            7.3. <strong>User may:</strong>
            <br />
            (a) submit a request to Developer for a copy of all personal data
            Third-Party Service collected and stored in connection with them;
            <br />
            (b) submit a request to Developer for the timely deletion of all
            personal data Third-Party Service collected and stored in connection
            with them, with the exception of essential data that Developer may
            preserve if and as permitted by applicable law. Examples of
            essential data vary by jurisdiction and may include but are not
            limited to data required for performing legal obligations, defense
            of legal claims, public interest or transactional history for the
            purpose of fulfilling tax obligations;
            <br />
            (c) amend, restrict, or object to the processing of their data, or
            exercise the option to revoke any previously given consent at any
            time and for any reason, including withdrawing from Policy entirely
            and discontinuing their use of Third-Party Service;
            <br />
            (d) lodge a complaint with national data protection authorities
            having jurisdiction if they believe their rights are not being
            upheld by Developer.
          </p>
          <p style={pStyle}>
            7.4. <strong>User shall:</strong>
            <br />
            (a) provide accurate and up-to-date information when submitting data
            requests to Developer, and cooperate with any reasonable measures
            necessary for Developer to fulfill these requests;
            <br />
            (b) adhere to the terms set forth in Policy and any additional
            policy enacted by Developer or Telegram.
          </p>

          {/* 8. Changes */}
          <h2 style={h2Style}>8. Changes to this Privacy Policy</h2>
          <p style={pStyle}>
            While we do not anticipate frequent changes, we will review and may
            update this Privacy Policy from time to time. Any changes to this
            Privacy Policy will become effective when we post the revised
            Privacy Policy on this page{" "}
            <a
              href="https://telegram.org/privacy-tpa"
              target="_blank"
              rel="noreferrer"
              style={linkStyle}
            >
              https://telegram.org/privacy-tpa
            </a>
            . Please check our website frequently to see any updates or changes
            to this Privacy Policy, a summary of which we will set out below.
          </p>

          <hr
            style={{
              border: 0,
              borderTop: `1px solid ${theme.separator}`,
              margin: "14px 0",
            }}
          />

          <div style={smallStyle}>
            Last updated: {new Date().toLocaleDateString()}
          </div>
        </section>

        <footer style={{ marginTop: 12 }}>
          <p style={{ ...smallStyle, lineHeight: 1.5 }}>
            Need help? Contact the Developer from inside the bot or mini app, or
            via the official Dial channels.
          </p>
        </footer>
      </div>
    </main>
  );
}
