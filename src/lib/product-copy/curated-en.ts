// src/lib/product-copy/curated-en.ts — English S&K + activation for curated variants.
//
// Key = supplierFingerprint() who entered CURATED_VARIANT_COPY (identical lock).
// resolve.ts picks this map only for locale=EN and only when the fingerprint
// still matches; WR text changes fall back to the tidied WR text exactly like ID.
// Numbers, prohibitions, and warranty limits mirror the ID curation.

export type CuratedVariantCopyEn = {
  paket?: readonly string[];
  proses?: readonly string[];
  aturan?: readonly string[];
  garansi?: readonly string[];
  langkah?: readonly string[];
  grupLangkah?: readonly { judul: string; langkah: readonly string[] }[];
  catatan?: readonly string[];
};

const ACCOUNT = "Ready-to-use account (just log in)";
const MBO = "Created after order (made by order) and cannot be expedited";
const BF_ONLY = "Warranty applies only if the account returns to the free version (backfree)";
const NO_WARRANTY = "No warranty";
const NO_WARRANTY_NO_COMPLAINT = "No warranty and no complaints";
const USE_IMMEDIATELY = "Ready to use right after purchase";
const LIFETIME = "Lifetime duration: active until the account stops by itself (not a permanent guarantee)";
const SHARING_LIMIT = "Sharing accounts risk hitting limits; please be patient and wait your turn";
const ZERO_TOLERANCE = "Zero tolerance: breaking any rule above means the account is revoked and the warranty is void";
const LOGIN_EMAIL = "Log in with email";
const maxLogin = (n: number | string) => `Maximum login on ${n} devices`;
const maxUse = (n: number) => `Maximum use on ${n} devices`;
const quickUse = (mass: boolean) =>
  `Ready to use right after purchase, because no one knows when a${mass ? " mass" : ""} ban will happen`;
const NETFLIX_UNINSTALL = "Uninstall the Netflix app first, then reinstall it";
const NETFLIX_GUIDE = "Full login guide: axvara.tech/go/netflix-login";
const NETFLIX_MAILBOX = "Open axvara.tech/go/otp for the access code and PIN";
const CAPCUT_UPDATE = "Update the CapCut app to the latest version so the email is not read as unregistered";
const YT_FAMILY_RULES = [
  "Make sure the email is not already in another family group",
  "Previously joined another YouTube Family (only 1x)? Leave that family first",
  "1 account can join a family only 2x per year; if the limit is reached, use another email",
];
const SPOTIFY_LOGIN = [
  "Uninstall the Spotify app and clear its data before logging in",
  "Turn on airplane mode once before logging in",
  "Log in using mobile data, not home WiFi",
  "If asked for an OTP at login, choose Use Password",
];
const VIDIO_BF = "Warranty applies only if the account returns to the free version (backfree), not for bans, hacks, or limits";
const VIU_NOTE = "Viu accounts very rarely return to free; frequent backfree is usually caused by logging in on many devices or sharing with many people";
const ZOOM_PACKAGE = "Private Zoom Pro account for 100 participants, fresh account";
const ZOOM_PROCESS = "Created after order (made by order) and cannot be expedited; if possible, order the day before use";
const ZOOM_RULES = [
  "Maximum use on 1 device; private account, not for sharing",
  "Activation only through the official Zoom website and app",
];
const ZOOM_WARRANTY = "Backfree warranty from purchase: applies if the account returns to the free version, not if the account is banned or suspended";
const ZOOM_STEPS = [
  "Do not mistype the email and password at login because the account can be locked",
  "If asked for device permission, click “Verify with a one-time passcode”, then open the OTP access link from us",
  "If asked to verify the account, click Skip",
];
const ZOOM_NOTE = "Cloud recordings can be opened at zoom.us/recording; recordings saved to file are stored in your device's Documents folder";
const TV_PACKAGE = "Full feature details: axvara.tech/go/tv-harga";
const VCC_RULES = [
  "One order is for one use only; a VCC can only be used once",
  "Buy only if you already understand how to use it",
  "VCC charged (bill received)? You must reimburse 2x the amount",
];
const OFFICE_PACKAGE = [
  "Original Microsoft 365 account (100%), just log in",
  "Includes Word, Excel, PowerPoint, OneNote, Outlook, plus Publisher and Access (Windows only)",
  "For all devices: iOS, Android, Windows, iPad, and tablets",
  LIFETIME,
  "Can be reinstalled multiple times",
];
const OFFICE_WARRANTY = "OneDrive is only a bonus: OneDrive issues are outside our responsibility, keep important files offline";
const OFFICE_APPS = [
  "Office already installed? Log in directly in Word",
  "On a tablet or phone, download Microsoft 365 from the App Store or Play Store",
];
const OFFICE_TUTORIAL = "Tutorial to download and install Office 365 on a computer: axvara.tech/go/office-install";
const APP_NEW_PROCESS = [MBO];
const WETV_COMMON_RULES = [
  "Do not change the password, tamper with the account, or tamper with payment",
  "You must send a screenshot of successful login to the admin",
];
const WETV_WARRANTY = [
  "Warranty applies as long as the terms & conditions are followed; violation incurs a Rp100k fine and the warranty is void",
  "No warranty for app policy changes outside our control",
];
const WETV_PERIOD = "Active period 25-30 days counted as 1 month";
const STREAM_SHARING_WEB = "Sharing account, recommended to watch via the website";
const NO_SMART_TV = "Does not work on Smart TV or TV Box";
const DISNEY_SHARING = ["Sharing account for 3 users, anti limit", "Works on TV and phones, not on the website"];
const DISNEY_JASPAY = [
  "Premium plan with a 3-device screen limit",
  "Payment service (jaspay) on your own number",
  "May be resold as sharing for 3, 6, or 10 users",
];
const GROK_RULES = "Do not tamper with account data (email, password, payment)";
const GROK_STEPS = [
  "Log in to the account we send via Google (Gmail)",
  "Open Grok, choose sign in with Google, then select that email",
];
const VPN_WEB_APP = "Activation only through the official website and app";
const KIRO_PACKAGE = ["Ready-to-use account (just log in)", "Claude Opus 4.7 and Opus 4.6 models available"];
const KIRO_RULES = "The active period ends at the end of the month: use up the limit before then";
const KIRO_STEPS = ["Download the Kiro app (similar to VS Code and Antigravity)", "Log in using the account we send"];
const UPCLOUD_VPS = "Can create a 6-core VPS with 12GB RAM";
const UPCLOUD_PROCESS = "Pre-order: created after order (made by order)";
const CANVA_LINK_STEPS = [
  "Log in to Canva with your personal account first",
  "Click the access link we send; the link can only be clicked 1x",
];
const CANVA_LINK_NOTE = "The link is only for you: do not share it or let anyone else click it";
const GEMINI_PACKAGE = [
  "Gemini Pro plan via a family invitation to your personal email",
  "Includes Flow, Antigravity, NotebookLM, and 5 TB storage",
  "AI credits/limits and storage are shared, used together with other members without complaints",
  "Your storage content stays private; other members cannot see it",
];
const GEMINI_RULES = [
  "Make sure the email has never been registered in any Family Plan",
  "Previously joined another family? Leave it first; if it still fails, you must use another email",
];

export const CURATED_VARIANT_COPY_EN: Record<string, CuratedVariantCopyEn> = {
  "150rofm6drp": {
    paket: ["Basic plan, sharing account for 3 users", "Does not include Fish purchases inside episodes"],
    aturan: ["One checkout is for 1 device only", "Cannot log in directly on TV"],
    garansi: [BF_ONLY],
  },
  "255seano9fm": {
    paket: [
      "1 account used by 2-3 users, choose any profile",
      "Log in with password or link",
      "Can watch in the app; if not, watch via desktop browser or TV",
      "Some older devices are not supported; use another device",
      "Non-official (black market) account: understand the risk before buying; for more safety, choose the Legal variant",
    ],
    aturan: [
      "One checkout is for 1 device only",
      "Cannot set a PIN or create your own profile",
      "Strictly forbidden to rename the profile, use a PIN, or change the account password and profile",
      "Signing out is forbidden",
      "Strictly forbidden to use any VPN",
      ZERO_TOLERANCE,
    ],
    garansi: [
      "20-day warranty, including screen limits; the account may occasionally show errors or incorrect password and is still covered",
      "Warranty repair estimate 1x24 hours",
      "Got an error? Report it to the admin immediately",
    ],
    langkah: [
      NETFLIX_UNINSTALL,
      "Log in the first time using mobile data (or a phone hotspot), because not every WiFi network can be used to log in to Netflix",
    ],
  },
  "1mwpinolrt6": {
    paket: [
      "Premium Ultra HD 4K plan",
      "1 profile for 1 device",
      "You may change the profile and PIN, but must report the new data to the admin",
      "Household verification (OTP) is processed manually by the admin",
      "Active period 25-30 days counted as 1 month",
    ],
    aturan: [
      "Log in on 1 device only; more than 1 can cause account errors",
      "Do not change the email and password",
      "Do not lend or share the password with anyone",
      "Do not tamper with payment and the plan, including pressing Cancel Membership",
      "Incorrect password? Switch to mobile data; if it still fails, report to the admin and do not click reset",
      ZERO_TOLERANCE,
    ],
    garansi: ["Warranty repair 1x24 hours"],
    grupLangkah: [
      {
        judul: "Before logging in",
        langkah: [
          NETFLIX_UNINSTALL,
          "You must log in using mobile data (or a phone hotspot), especially on the first login, because not every WiFi network can be used to log in to Netflix",
        ],
      },
      {
        judul: "Login in the app",
        langkah: [
          "Open the app, then tap Sign In",
          "Enter the email",
          "If asked for a code, tap Get Help",
          "Choose Use Password, then enter the password",
        ],
      },
      {
        judul: "Login on the website",
        langkah: [
          "Clear cache and cookies if you have logged in before",
          "Click Sign In",
          "Click Get Help, then Learn more about signing in",
          "Click Join Netflix in the top right corner",
          "Click Sign In in the top right corner, then enter the email and password",
        ],
      },
    ],
  },
  "1en2ppvmiln": {
    paket: [ACCOUNT, "Duration over? Log out then log in to a new account; your edits are not lost"],
    aturan: [maxLogin(2), "Log in with email, not Google", "Do not claim the CapCut trial"],
    garansi: [
      "Warranty applies if the account returns to the free version (backfree)",
      "No warranty for Maximum status (too many logins)",
    ],
    langkah: [
      CAPCUT_UPDATE,
      "Log in on your phone using the email and password from us",
      "For PC, log in by scanning the QR from the app on your phone",
      "Check Pro status on your phone: tap Pro next to the long number row",
      "Check Pro status on PC or web: switch the space at the bottom left",
    ],
  },
  "1ljmky1hnoh": {
    paket: ["Pro Member plan, duration directly 1 month (not a renewal)", "Ready-to-use account (just log in) with legal payment"],
    aturan: [
      "Maximum login on 2 devices, including PC or laptop",
      "Log in with email, not Google",
      "Do not log in and out too often because it can cause account errors",
      "Do not resell as sharing: it can hit login limits and is not covered by warranty",
    ],
    garansi: [
      "Warranty applies only if the account returns to the free version (backfree), not suspension",
      "No warranty for Maximum status (too many logins)",
    ],
    langkah: [
      CAPCUT_UPDATE,
      "Log in on your phone using the email and password from us",
      "For PC or laptop, log in by scanning the QR from the app on your phone",
    ],
  },
  "25xbmeu3ld0": {
    paket: [
      "3-day active period following the selected dates, not 72 hours from purchase",
      "Sharing account: limits are shared with other users",
      "Login only via the website or phone app",
    ],
    proses: ["Login access is sent on H-1 of the schedule, in the evening", "Recommended to order before or on the first day of the schedule"],
    aturan: [
      "Do not use the Fable model",
      "Do not generate images",
      "Do not use for coding or connect it to coding tools",
      "Do not use the API or connect the account to third-party services (9Router, and similar)",
      "Limits can be reached at any time; understand the risk before buying",
    ],
  },
  "1yn33ohw2dc": {
    paket: [
      "3-day active period following the selected dates, not 72 hours from purchase",
      "Sharing account: limits are shared with other users",
      "Login only via the website or phone app",
    ],
    proses: ["Login access is sent on H-1 of the schedule, in the evening", "Recommended to order before or on the first day of the schedule"],
    aturan: [
      "Do not use the Fable model",
      "Do not generate images",
      "Do not use for coding or connect it to coding tools",
      "Do not use the API or connect the account to third-party services (9Router, and similar)",
      "Do not use High, Extra, or Max effort levels",
      "Exception: High effort may be used with the Sonnet model, not with Opus",
      "Limits can be reached at any time; understand the risk before buying",
    ],
  },
  "21qzoavouza": {
    paket: ["YouTube Family invitation to your personal email"],
    proses: ["Invitation is sent in the evening"],
    aturan: YT_FAMILY_RULES,
  },
  "10hp1pmqnpd": {
    paket: ["YouTube Family invitation link for your personal email", "Link is valid for 3 days"],
    aturan: YT_FAMILY_RULES,
    langkah: ["Click the invitation link we send", "Log in with your personal email, then accept the family invitation"],
  },
  "s1lgeuek0b": {
    paket: ["Ready-to-use account", "Supports Seedance 2.0"],
    garansi: ["Warranty only covers the account being able to log in"],
    langkah: [
      "Open the Leonardo AI website",
      "Choose sign in via Canva, then choose sign in with email",
      "Get the OTP code at axvara.tech/go/otp-bot",
      "The password is only a backup; prefer logging in with the OTP",
    ],
  },
  "cvd3a73y8j": {
    paket: ["Ready-to-use account", "Supports Seedance 2.0"],
    garansi: ["Warranty only covers the account being able to log in"],
  },
  "1fiqy7j66lt": {
    paket: ["Ready-to-use account, duration directly 3 months"],
    aturan: ["Do not log in on more than 1 device", "Do not change the email or password"],
    garansi: [
      "Warranty only covers the account being able to log in; otherwise no warranty",
      "The account can backfree or be suspended at any time: this risk is without complaint",
      "Check the billing right after login; it must be Premium 3 months; if not, report to the admin via WhatsApp within 24 hours of receiving the account",
    ],
    langkah: SPOTIFY_LOGIN,
  },
  "1fox9vmug7g": {
    paket: ["Ready-to-use account"],
    aturan: [
      "Log in on 1 device only because Spotify is sensitive to device IP",
      "Do not change the email",
      "Do not tamper with payment or the subscription plan",
    ],
    garansi: ["25-day warranty", "Warranty repairs depend on stock availability, no refund requests"],
    langkah: SPOTIFY_LOGIN,
    catatan: ["See a red banner or the text “payment cancelled / could not be completed”? Ignore it and press X"],
  },
  "scwvizd536": {
    paket: [
      "Activation on your own number: the Getcontact number must be an active WhatsApp number",
      "Search limit 300 per month and tag list 40 per month",
      "Can be renewed",
    ],
    proses: ["Processed every night; the process is slow and cannot be expedited", "Stay on your number during the process"],
  },
  "own2y42xlz": {
    paket: ["Family invitation to your personal email", "Works on Android and iOS", "Can be renewed monthly on the same account"],
    proses: ["Invitation is sent in the afternoon or evening", "After joining, status sometimes lags: close the app and wait 60 minutes"],
    aturan: ["Already in another family? Leave it before joining"],
  },
  "pov46rjkyp": {
    paket: ["ChatGPT Go voucher, 3-month duration", "Region Mexico (MX)"],
    aturan: [
      "Do not buy if you do not understand how to redeem this voucher; buying means you already understand",
      "Does not include a redemption tutorial",
    ],
  },
  "ie8ec098t1": {
    paket: ["ChatGPT Plus account (iCloud or Outlook email)", "Billing via GCash"],
    aturan: [maxLogin(2), "Do not tamper with the account", "Codex requires WhatsApp number verification", quickUse(false)],
    garansi: [NO_WARRANTY_NO_COMPLAINT],
    langkah: [
      "After logging in, open Settings",
      "Go to Security, then Sessions",
      "Choose Logout All Devices",
    ],
    catatan: ["The goal is to clear devices still attached; too many devices make the account get banned faster"],
  },
  "1m77fg8i6oi": {
    paket: [
      "Private invitation to your personal email",
      "Chat history is safe and not mixed with other users",
      "Cannot use Codex",
    ],
    aturan: [quickUse(true)],
    garansi: ["1-day warranty"],
  },
  "1vc36szlokt": {
    paket: ["Your own account, not an invitation", "Billing via VCC (1 VCC for 1 account), longer lasting and more stable"],
    aturan: [maxLogin(2), "Codex requires WhatsApp number verification", quickUse(true)],
    garansi: ["7-day warranty"],
  },
  "21fsyz2kxb5": {
    paket: ["Platinum plan specifically for TV", "Ready-to-use account"],
    aturan: [maxLogin(2)],
    garansi: [VIDIO_BF],
  },
  "135t5v6pyib": {
    paket: ["Platinum plan specifically for mobile (phone or tablet)", "Ready-to-use account"],
    proses: ["Ask the admin about stock availability before buying"],
    aturan: [
      "Maximum login on 2 devices, but 1 device is recommended so the account is not disabled",
      "Do not change the email or password: if caught, the account is revoked and without warranty",
      "Changing account settings until an error occurs incurs a fine equal to the private account price",
    ],
    garansi: [
      "Warranty covers a banned account",
      "No warranty if the account is stolen or disabled",
    ],
  },
  "1c98n0ezuni": {
    paket: ["Platinum plan for all devices", "Ready-to-use account", "Active period 25-30 days counted as 1 month"],
    proses: ["Ask the admin about stock availability before buying"],
    aturan: [
      maxLogin(2),
      "Do not change the account email or password",
      "Do not tamper with payment",
      "You must send proof of login to the admin to confirm the account is safe without issues",
    ],
    garansi: [
      BF_ONLY,
      "Does not apply to bans, hacks, limits, disable, incorrect password, or stolen accounts",
    ],
  },
  "1n7qd81est7": {
    paket: ["Premium plan (not Plus), ad-free access", "Ready-to-use account"],
    aturan: [maxLogin("1-2"), "Do not change the email or password"],
    garansi: [NO_WARRANTY],
    langkah: ["Clear the Viu app data before logging in"],
    catatan: [VIU_NOTE],
  },
  "1w6j2f99iig": {
    paket: ["Premium plan (not Plus), ad-free access", "Ready-to-use account"],
    aturan: [maxLogin("1-2"), "Do not change the email or password"],
    garansi: [
      "2-month warranty, only applies if the account returns to the free version (backfree)",
      "Warranty claim processing maximum 3x24 hours",
      "No warranty for disabled or deactivated accounts",
      "No warranty for app policy changes outside our control, including if the activation method stops or changes",
    ],
    langkah: ["Clear the Viu app data before logging in"],
    catatan: [VIU_NOTE],
  },
  "2g1ibt8ur0s": {
    paket: [ZOOM_PACKAGE, "Active period 12-14 days"],
    proses: [ZOOM_PROCESS],
    aturan: ZOOM_RULES,
    garansi: [ZOOM_WARRANTY],
    langkah: ZOOM_STEPS,
    catatan: [ZOOM_NOTE],
  },
  "htpja16mam": {
    paket: [ZOOM_PACKAGE, "Automatically renewed every 14 days"],
    proses: [ZOOM_PROCESS],
    aturan: ZOOM_RULES,
    garansi: [ZOOM_WARRANTY],
    langkah: ZOOM_STEPS,
    catatan: [ZOOM_NOTE],
  },
  "9fur7a5iul": {
    paket: ["Ready-to-use account for all devices", "Does not include rental films"],
    aturan: [USE_IMMEDIATELY],
    garansi: [NO_WARRANTY],
  },
  "123wzsoo0tq": {
    paket: [
      "Ready-to-use account for all devices",
      "Prime with ads plan: only 15 seconds of ads at the start",
      "Does not include rental films",
    ],
    aturan: [maxLogin(2)],
  },
  "1s4emey5naj": {
    paket: ["Premium plan (worth $69.95)", ACCOUNT, TV_PACKAGE],
    proses: [MBO],
    garansi: [NO_WARRANTY_NO_COMPLAINT],
  },
  "uwqn5zd0nv": {
    paket: ["Premium plan (worth $69.95)", ACCOUNT, TV_PACKAGE],
    proses: [MBO],
    garansi: ["Backfree warranty: applies if the account returns to the free version"],
  },
  "tdxkgajlr1": {
    paket: ["Ready-to-use account"],
    aturan: [maxLogin(2)],
  },
  "6r4t0ocizg": {
    paket: ["HMA VPN key (license code)", "Windows and Android only"],
    proses: [MBO],
    aturan: [maxUse(5), "Activation only through the official app"],
    garansi: ["No refund after successful activation"],
    langkah: ["Install the HMA VPN app, then log in using the key we send"],
  },
  "1b6erf68baz": {
    paket: ["Fresh account with an activation key"],
    proses: [MBO],
    aturan: [maxUse(5), VPN_WEB_APP],
  },
  "7hxxxhegzn": {
    paket: ["VCC to claim the UpCloud trial", "VCC active for 1-3 hours, ready to use after receipt"],
    aturan: [...VCC_RULES, "Use only in the matching app (UpCloud)"],
  },
  "28gb79iogo7": {
    paket: ["VCC to claim the TradingView trial", "VCC active for 1-3 hours, ready to use after receipt"],
    aturan: [...VCC_RULES, "Use only in the matching app (TradingView)"],
  },
  "1q6ymq7voq1": {
    paket: OFFICE_PACKAGE,
    aturan: [maxUse(5)],
    garansi: [OFFICE_WARRANTY],
    langkah: [
      "Open axvara.tech/go/office-login",
      "Enter the email and password we send",
      "On first login you are asked to change the password: create a new one and do not forget it",
      "If asked to add a phone number or email, fill in either one (only for extra security)",
      ...OFFICE_APPS,
    ],
    catatan: [OFFICE_TUTORIAL],
  },
  "1h1cv30d09z": {
    paket: OFFICE_PACKAGE,
    proses: ["Send your chosen username to the admin via WhatsApp after ordering"],
    aturan: [maxUse(5)],
    garansi: [OFFICE_WARRANTY],
    langkah: OFFICE_APPS,
    catatan: [OFFICE_TUTORIAL],
  },
  "afyqev2tjv": {
    paket: OFFICE_PACKAGE,
    proses: ["Send your chosen username to the admin via WhatsApp after ordering"],
    aturan: [maxUse(5)],
    garansi: [OFFICE_WARRANTY],
    langkah: OFFICE_APPS,
    catatan: [OFFICE_TUTORIAL],
  },
  "6r1ndf34qa": {
    paket: [
      "Original retail key for Windows 10 Pro and Windows 11 Pro",
      "Permanent activation",
      "Can be used to reinstall on the same 1 device",
    ],
    langkah: [
      "Make sure the Windows version is already Pro before activation",
      "Enter the key in Windows Settings",
      "Choose activation by phone",
    ],
    catatan: ["Activation is done during working hours 09.00-17.00 WIB, while the server is online"],
  },
  "7r4odcx4n1": {
    paket: ["Ready-to-use account with access to Pro features"],
  },
  "ir9q4z9zqg": {
    paket: ["Fresh account, Android only", LOGIN_EMAIL],
    proses: APP_NEW_PROCESS,
  },
  "pyoqht7w43": {
    paket: ["Fresh account, works on iOS and Android", LOGIN_EMAIL],
    proses: APP_NEW_PROCESS,
  },
  "1vnaeufq33": {
    paket: ["Fresh account, Android only; iOS users choose the VIP+ variant", LOGIN_EMAIL],
    proses: APP_NEW_PROCESS,
  },
  "205ut6u7kqc": {
    paket: ["Fresh account, works on Android and iOS", LOGIN_EMAIL],
    proses: APP_NEW_PROCESS,
  },
  "1cp6pu7gd18": {
    paket: ["Redeem link for the subscription, not an email and password", "Website only, does not work in the mobile app"],
    aturan: ["Prepare your own Gmail account for redemption"],
    langkah: [
      "Open the redeem link in a browser",
      "Choose sign in with Google using that Gmail account to redeem the subscription",
    ],
  },
  "50e1oa198c": {
    paket: ["Sharing account: watch history is automatically mixed with other users"],
    aturan: [
      "Log in on 1 device only, using email (not Google)",
      "Do not tamper with payment or anything related to account information",
      "Sharing accounts risk limits; be patient and wait your turn; screen limits only exist on VIP episodes and are not eligible for complaints",
      "Fraud or actions that harm us incur sanctions or fines",
    ],
    garansi: ["1-month warranty", "Warranty is void if these terms & conditions are violated"],
    langkah: ["Log in with email and password via the website; watching is recommended in a browser such as Chrome"],
    catatan: [
      "Login error (e.g. “incorrect password” or “an error occurred”)? Try logging in via the website first",
      "Hit a limit? Download the episode first to watch in the meantime",
    ],
  },
  "2gljpitnm2v": {
    paket: ["Sharing account for 3 users, anti limit", WETV_PERIOD],
    aturan: [
      "Log in on 1 device only, using a regular email (not Google)",
      "Total logins on this account maximum 6 users/devices; more than that and the account is suspended without warranty",
      ...WETV_COMMON_RULES,
    ],
    garansi: WETV_WARRANTY,
  },
  "1i4pkhjb2mi": {
    paket: [
      "Ready-to-use account, log in with a phone number or regular email (not Google)",
      "May be resold as sharing for up to 6 users",
      "Screen limit 3 devices at once",
      WETV_PERIOD,
    ],
    aturan: ["Maximum 6 users/devices; more than that and the account is suspended without warranty", ...WETV_COMMON_RULES],
    garansi: WETV_WARRANTY,
  },
  "10fg8iko62y": {
    paket: [STREAM_SHARING_WEB, NO_SMART_TV],
    aturan: [
      "Log in on 1 device only",
      SHARING_LIMIT,
      "Do not change account data or payment; do not click the subscription/payment menu because it can be detected",
      "Do not log in and out repeatedly and avoid suspicious activity",
      "Breaking the rules causes the account to be suspended, without compensation",
    ],
    langkah: ["You must clear the app cache and data before logging in", "Log in with the account we send"],
    catatan: ["Cannot log in? Do not keep trying; contact the admin immediately"],
  },
  "12e4aaiy2vk": {
    paket: [STREAM_SHARING_WEB, NO_SMART_TV],
    aturan: [
      "Log in on 1 device only",
      SHARING_LIMIT,
      "Do not change account information (email, password, payment, and others)",
      "Do not log in and out repeatedly without a clear reason",
      "Do not delete other users' watch history",
    ],
    catatan: ["Hit a screen limit? Wait until your turn comes around, or download the show to watch offline"],
  },
  "1w13tik3vez": {
    paket: ["Ready-to-use account for Android and the website (not for iOS)"],
    aturan: [
      "Log in on 1 device only, using email and password (not Google)",
      "Do not change the email or password",
      "Do not tamper with payment or anything related to account information",
    ],
  },
  "8woact3bv2": {
    paket: ["Ready-to-use account"],
    aturan: ["Maximum login on 3 devices; for iOS only 1 device"],
  },
  "5xqem2png8": {
    paket: ["Ready-to-use account, works on Android and iOS"],
  },
  "s0cjewl2a4": {
    paket: DISNEY_SHARING,
    aturan: ["Works on 1 device only", "Recommended to log in on TV for more stability and fewer logouts"],
    langkah: ["Full login guide: axvara.tech/go/disney-login"],
  },
  "xatzf9m25w": {
    paket: [...DISNEY_JASPAY, "Official price Rp119k"],
  },
  "1kjxjx9mnax": {
    paket: [...DISNEY_SHARING, "Official price Rp799k"],
    aturan: [
      "Works on 1 device only",
      "Do not press “Sign out all devices” and do not log out",
      "Do not clear cache, clear data, especially not use cleaner apps",
      "Do not do anything that disturbs other users",
    ],
    langkah: ["Chat the admin to request the login OTP code", "Log in using that OTP; the OTP is given only once and for 1 device only", "Full login guide: axvara.tech/go/disney-login"],
  },
  "29bev6iw5xs": {
    paket: [...DISNEY_JASPAY, "Official price Rp799k"],
  },
  "28nggg902hm": {
    paket: ["SuperGrok plan, log in with a Google account"],
    aturan: [GROK_RULES],
    langkah: GROK_STEPS,
  },
  "1itd4nsqzx9": {
    paket: ["SuperGrok plan, 10 accounts with Google login", "Fresh accounts with fresh billing"],
    proses: ["Pre-order system (PO)"],
    aturan: [GROK_RULES],
    langkah: GROK_STEPS,
  },
  "212jfbuesyx": {
    paket: ["SuperGrok plan, ready-to-use account"],
    aturan: ["You may only change the password and profile", "Do not link an X account"],
    garansi: ["Full warranty for backfree, incorrect password, and MFA", "No warranty if the email is changed"],
  },
  "1bnv7h7ssyx": {
    paket: [ACCOUNT],
    aturan: [maxUse(5), VPN_WEB_APP],
  },
  "1be18hn6h4r": {
    paket: ["Pro plan with 1000 credits", ...KIRO_PACKAGE],
    aturan: [KIRO_RULES],
    langkah: KIRO_STEPS,
  },
  "vwbz89rdos": {
    paket: ["Pro Plus plan with 2000 credits", ...KIRO_PACKAGE],
    aturan: [KIRO_RULES],
    langkah: KIRO_STEPS,
  },
  "5b6ps6s3ef": {
    paket: [
      "14-day Pro trial, suitable for vibe coding",
      "Claude Opus 4.6, Opus 4.7 MAX, GPT 5.5, and Kimi 2.6 models available",
    ],
    aturan: ["Many new users, so it sometimes hits a global limit: type “lanjutkan” until it succeeds"],
    langkah: ["Install the Windsurf IDE (similar to VS Code)", "Log in using the devin.ai account we send"],
  },
  "op95kbixch": {
    paket: ["Premium 4K UHD plan", "Sharing account for 4 users, anti screen limit", "For all devices (mobile and TV)"],
    aturan: ["Log in on 1 device only", USE_IMMEDIATELY],
    garansi: [NO_WARRANTY],
  },
  "hztjmbmqbr": {
    paket: [
      "Premium 4K UHD plan (official price Rp119k), private account",
      "Streaming on 4 devices at once, mobile or TV",
    ],
    proses: ["Created after order (made by order) so the account stays fresh"],
    aturan: [USE_IMMEDIATELY],
    garansi: [NO_WARRANTY],
  },
  "lffzty7lea": {
    paket: [STREAM_SHARING_WEB],
    aturan: ["Log in on 1 device only", SHARING_LIMIT],
  },
  "2e36p4bsu2c": {
    paket: ["Sharing account for Android or the website"],
    aturan: ["Log in on 1 device only", "Sharing accounts can hit limits; please be patient and wait your turn"],
  },
  "12w2t89p49d": {
    paket: ["Ready-to-use account, ad-free access", "10GB+ cloud storage"],
  },
  "1kmv595we6s": {
    paket: [
      "Name.com domain for 1 year; you get access to the domain",
      "Cannot be renewed",
      "Extension choices: .rocks, .ninja, .games, .codes, .systems, .studio, .email, .works, .software, .engineer, .live, .app, .dev, .page, .foo",
    ],
    langkah: ["Check domain name availability at axvara.tech/go/cek-domain", "Order on the website or Telegram bot. Then contact WhatsApp support at axvara.tech/wa with your order code and chosen domain name"],
  },
  "1my1m0jqwjj": {
    paket: ["Fresh account with a $250 balance", UPCLOUD_VPS],
    proses: [UPCLOUD_PROCESS],
    garansi: ["No warranty after successful login"],
  },
  "5fteui634g": {
    paket: ["Fresh account with a $500 balance", UPCLOUD_VPS],
    proses: [UPCLOUD_PROCESS],
  },
  "19kzvxtfqkz": {
    paket: ["Ready-to-use account"],
    langkah: ["Log in directly in the Adobe app using the account we send"],
  },
  "28mkwys4rce": {
    paket: ["Pro plan (official price Rp150k+) with 300 requests per month"],
    proses: ["Processing tends to be slow; it can be faster depending on the server"],
  },
  "2ealo0k3mcs": {
    paket: [
      "GitHub Student Developer Pack account",
      "Domains: 1 free .me domain + SSL certificate from Namecheap, 2 domains (.live, .studio, .software, .app, or .dev) from name.com, and 1 .tech domain from get.tech, each for 1 year for a website or portfolio",
      "GitHub Copilot Pro",
      "DigitalOcean: $200 balance for hosting or VPS for 1 year",
      "Microsoft Azure: $100 balance plus access to 25+ cloud services without a credit card",
      "JetBrains license: professional IDEs such as IntelliJ IDEA and PyCharm",
      "Full benefit list: axvara.tech/go/github-pack",
    ],
    aturan: ["Buy only if you already understand how to use it; no tutorial included", "Claim all benefits immediately because the account is prone to suspension"],
  },
  "6t7hp6jndi": {
    paket: [
      "Canva Edu access link for 1 join via your personal email",
      "Canva Edu is equivalent to Canva Pro, but cannot upload fonts and has limited AI access",
      LIFETIME,
    ],
    garansi: [NO_WARRANTY],
    langkah: CANVA_LINK_STEPS,
    catatan: [CANVA_LINK_NOTE],
  },
  "10sr91kzyw7": {
    paket: ["Canva Edu Head account, can invite 500 members", LIFETIME],
    garansi: [NO_WARRANTY],
  },
  "590xzj9a67": {
    paket: ["Canva Pro Head account (email and password), can invite 100 members"],
    proses: [MBO],
  },
  "7nslhsale1": {
    paket: ["Canva Pro team join link, renewed free every month", "May be resold or shared again"],
  },
  "1yg0dwzho35": {
    paket: ["Member Pro plan, duration directly 2 months without changing teams", "Team invitation to your personal Canva account"],
    langkah: CANVA_LINK_STEPS,
    catatan: [CANVA_LINK_NOTE],
  },
  "1wob3hzdl2h": {
    paket: GEMINI_PACKAGE,
    proses: ["Invitation is processed manually"],
    aturan: GEMINI_RULES,
  },
  "191n7xk0kr2": {
    paket: [...GEMINI_PACKAGE, "17-18 month duration"],
    proses: ["Invitation is processed manually, please be patient"],
    aturan: GEMINI_RULES,
  },
  "1jw011nczs3": {
    paket: [
      "Gemini Pro Head account, Indonesia region, can invite 5 members",
      "Includes Flow (1000 AI credits), Antigravity, NotebookLM, and 5TB storage",
    ],
    garansi: ["Warranty applies if the account returns to the free version (backfree), excluding suspension, disable, or deactivation"],
    grupLangkah: [
      {
        judul: "First login",
        langkah: [
          "You must log in the first time from a phone, not a laptop/PC, because the Gmail will definitely be locked",
          "If asked for phone or OTP verification, enter your personal phone number; this number is only for device verification and is not stored on the Google account",
          "After a successful login, leave the account alone for 7 days",
        ],
      },
      {
        judul: "After 7 days",
        langkah: [
          "Secure the account: change the password, set up recovery, and enable 2FA",
          "Sign out all other device sessions so the account is not locked",
        ],
      },
    ],
  },
  "tnadrfyj5t": {
    paket: [
      "Netflix account from the admin, duration 28-30 days counted as 1 month",
      "1 profile used by 2 users, watch on your own profile",
      "Safe from limits if you follow the terms & conditions",
    ],
    aturan: [
      "Use on 1 device only",
      "Do not tamper with the account and payment",
      "Before logging in you must clear data or reinstall the Netflix app, then change network",
      "Login in a browser: clear cookies first at www.netflix.com/clearcookies, then open www.netflix.com/youraccount",
    ],
    garansi: ["Full warranty until the active period ends"],
    grupLangkah: [
      { judul: "Get the access code", langkah: [NETFLIX_MAILBOX, NETFLIX_GUIDE] },
      { judul: "Login on phone", langkah: ["Reinstall the app or clear its data", "Change network, then log in"] },
      { judul: "Login in browser", langkah: ["Open www.netflix.com/clearcookies", "Then open www.netflix.com/youraccount and log in"] },
    ],
  },
  "gzz7rpib4v": {
    paket: [
      "Private Netflix account from the admin, duration 28-30 days counted as 1 month",
      "Legal account with full warranty",
      "You may change the profile name and its PIN",
    ],
    aturan: [
      "Use on 1 device only",
      "Do not tamper with the account and payment",
      "Before logging in you must clear data or reinstall the Netflix app, then change network",
      "Login in a browser: clear cookies first at www.netflix.com/clearcookies, then open www.netflix.com/youraccount",
    ],
    garansi: ["Full warranty until the active period ends"],
    grupLangkah: [
      { judul: "Get the access code", langkah: [NETFLIX_MAILBOX, NETFLIX_GUIDE] },
      { judul: "Login on phone", langkah: ["Reinstall the app or clear its data", "Change network, then log in"] },
      { judul: "Login in browser", langkah: ["Open www.netflix.com/clearcookies", "Then open www.netflix.com/youraccount and log in"] },
    ],
  },
  "lqpivppqmh": {
    paket: [
      "ChatGPT Plus sharing account from the admin, active period 28-30 days from delivery",
      "Activity and chat history may be visible to other users",
      "No special limit from the store; follows the ChatGPT account and service limits",
    ],
    aturan: [
      "Use on 1 device only; do not log out or switch devices after logging in",
      "Log in with the device you will actually use",
      "Do not change the email, password, or account security info",
      "Do not share the account and login details with others",
      "Do not tamper with payment settings",
      "Verification codes can only be used once; the access PIN has a usage limit and cannot be increased",
    ],
    garansi: ["If you have an issue during the active period, contact the admin for help under the warranty terms"],
    grupLangkah: [
      {
        judul: "Login",
        langkah: [
          "Open the ChatGPT app or website, log in with the email from the admin",
          "When asked for a verification code, choose to send the code to email",
          "Open axvara.tech/go/otp, enter the ChatGPT email and the access PIN from the product data",
          "Enter the generated code into ChatGPT",
        ],
      },
    ],
  },
  "ldn032sbn4": {
    paket: [
      "Private Individual Spotify account from the admin, duration 28-30 days",
      "Legal account with full warranty, supports all devices",
    ],
    aturan: [
      "Clear app data before logging in",
      "You must log in using mobile data, not home WiFi",
      "If asked for an OTP at login, choose Use Password",
      "Request the OTP at axvara.tech/go/otp-spotify after logging in with the email",
      "Log in directly on the Spotify website or app",
    ],
    garansi: [
      "Full warranty for an account returning to the free version and a disabled account during 28-30 days",
      "Claim estimate 1-7 days; if not yet warranted, chat again",
    ],
    langkah: [
      "Clear the Spotify app data before logging in",
      "Log in with the email, then request the OTP at axvara.tech/go/otp-spotify",
      "Use mobile data when logging in, not home WiFi",
    ],
  },
  "iqxrel5pre": {
    paket: [
      "Private CapCut account from the admin, 7-day duration, supports all devices",
      "Free to change the password",
      "Maximum use on 2-3 devices",
    ],
    aturan: [
      "Maximum sharing for 2 users to avoid limits",
      "You must update the CapCut app to the latest version before logging in",
      "1 device is recommended; logging in on more risks Maximum status",
      "Check the account duration only via the website",
    ],
    garansi: [
      "Full 25-day warranty for an account returning to the free version (backfree)",
      "No warranty if the account hits Maximum; the solution is to wait a few hours before logging in again",
    ],
    langkah: [
      "Update the CapCut app to the latest version so the email reads as registered",
      "Log in on your phone using the email and password from us",
      "For PC, log in by scanning the QR from the app on your phone",
      "Check Pro status on your phone: tap Pro next to the long number row",
    ],
  },
  "22guuit2j3f": {
    paket: [
      "CapCut sharing account from the admin for 2 users, 7-day duration",
      "Legal account with warranty",
    ],
    aturan: [
      "Log in using the account provided",
      "You must reinstall the app first before logging in",
      "Log in on 1 device only; caught with multiple logins and it can be banned",
    ],
    garansi: ["Warranty applies under the store terms during the active period"],
    langkah: [
      "Reinstall the CapCut app before logging in",
      "Log in using the account provided, on 1 device only",
    ],
  },
  "1r8czlck528": {
    paket: [
      "Private Viu account from the admin, lifetime duration for all devices",
      "Can only log in on 1 device",
    ],
    aturan: ["Log in using the email or phone number provided", "Use on 1 device only"],
    garansi: ["3-month warranty (lifetime duration, limited 3-month warranty)"],
    langkah: ["Log in using the email or phone number provided, on 1 device only"],
  },
  "1bvuc4ltcp3": {
    paket: [
      "12-month Gemini redeem link for your own account",
      "Make sure your account is not currently active on any subscription",
    ],
    aturan: [
      "You must screen-record during redemption to avoid misunderstandings",
      "Use your own account",
    ],
    garansi: ["Warranty covers redemption only; if it backfrees that is the service terms"],
    langkah: ["Screen-record during the redemption process", "Redeem the link to your own account that is not currently subscribed"],
  },
  "26ov35dahpm": {
    paket: [
      "YouTube account from the admin (GSuite account), private, 25-day warranty",
      "Deactivated accounts are not covered by warranty",
    ],
    aturan: [
      "Sign in using the account provided",
      "Do not tamper with payment and subscriptions",
      "Do not change the password; just add a phone number and recovery email",
    ],
    garansi: ["1-month warranty (25 days); deactivated accounts are not covered"],
    langkah: ["Sign in using the GSuite account provided", "Only add a phone number and recovery email"],
  },
  "1nndgsue16b": {
    paket: [
      "Private Prime Video account from the admin, 5 profiles",
      "Active period 25-30 days counted as 1 month",
      "Legal account with warranty",
    ],
    aturan: [
      "Do not change the account region or tamper with payment while premium",
      "Strictly forbidden to change the password and email",
      "Amazon is sensitive: do not try logging in repeatedly in a short time; if the password is wrong or it fails, wait 5 minutes then refresh (close the tab or clear the app) before trying again",
      "Hit age verification? Create a new profile first; if it still happens, enter 1999/01/01",
      "Access email via axvara.tech/go/mail-olies",
    ],
    garansi: ["Warranty applies during the active period under the store terms"],
    langkah: [
      "Log in with the account from the admin; access email via axvara.tech/go/mail-olies",
      "Hit age verification? Create a new profile first, or enter 1999/01/01",
    ],
  },
  "1u5a75gqgda": {
    paket: [
      "Prime Video sharing account from the admin, 1 profile",
      "Active period 25-30 days counted as 1 month",
      "Legal account with warranty",
    ],
    aturan: [
      "Do not change the account region or tamper with payment while premium",
      "Strictly forbidden to change the password and email",
      "Amazon is sensitive: do not try logging in repeatedly in a short time; if the password is wrong or it fails, wait 5 minutes then refresh (close the tab or clear the app) before trying again",
      "Hit age verification? Create a new profile first; if it still happens, enter 1999/01/01",
      "Access email via axvara.tech/go/mail-olies",
    ],
    garansi: ["Warranty applies during the active period under the store terms"],
    langkah: [
      "Log in with the account from the admin; access email via axvara.tech/go/mail-olies",
      "Hit age verification? Create a new profile first, or enter 1999/01/01",
    ],
  },
  "yk2y6fqsje": {
    paket: [
      "Private Vidio Platinum Mobile account from the admin, 30-day duration",
      "Mobile only, but supports browser, PC, and laptop",
      "Watch on a laptop via axvara.tech/go/vidio-web",
      "You may change the password; email is inactive",
    ],
    aturan: [
      "Log in using email",
      "Do not tamper with payment and subscriptions",
      "Screen limit 1 user; 2 users are more at risk of disable",
      "Maximum use by 2 users to avoid limits",
      "You must update the Vidio app to the latest version before logging in",
      "1 device is recommended",
    ],
    garansi: [
      "30-day warranty only if the account returns to the free version (backfree)",
      "No warranty if the account is locked or hacked",
      "No warranty if the account hits Maximum; the solution is to wait a few hours before logging in again",
    ],
    langkah: [
      "Update the Vidio app to the latest version",
      "Log in using email, maximum 2 users",
      "For a laptop, watch via axvara.tech/go/vidio-web",
    ],
  },
};
