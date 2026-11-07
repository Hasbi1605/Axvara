-- 0106_product_name_variant_copy_en_seed.sql — nama & S&K admin EN (LOCAL ONLY).
--
-- Sumber: export produksi 2026-11-07. Nama hanya untuk yang butuh padanan
-- non-token (brand murni tidak disentuh). Varian = 9 suntingan admin yang ada.
-- Idempoten: hanya menulis baris yang kolom EN-nya masih NULL.

UPDATE products SET name_en='GSuite Account' WHERE slug='akun-gsuite' AND name_en IS NULL;
UPDATE products SET name_en='Cheap Domain' WHERE slug='domain-murah' AND name_en IS NULL;
UPDATE products SET name_en='Campus Email / Student (ac.id)' WHERE slug='email-kampus-student-ac-id' AND name_en IS NULL;
UPDATE products SET name_en='GitHub Student' WHERE slug='github-student' AND name_en IS NULL;
UPDATE products SET name_en='Muse AI 1 Billion Tokens' WHERE slug='muse-ai-1-miliar-token' AND name_en IS NULL;
UPDATE products SET name_en='UpCloud' WHERE slug='upcloud' AND name_en IS NULL;
UPDATE products SET name_en='VCC for App Trials' WHERE slug='vcc-trial-aplikasi' AND name_en IS NULL;

UPDATE product_variants SET admin_terms_en='If the link does not work, contact the admin via WhatsApp / Telegram; we will invite you manually!', admin_activation_en='1. Paste the link into Chrome
2. If you are already logged in to Canva, a popup to join the team will appear automatically
3. If you are not logged in, clicking the link will direct you to the login page
4. After a successful login, you will be redirected automatically to the Canva team invitation' WHERE id=1 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='If the link does not work, contact the admin via WhatsApp / Telegram; we will invite you manually!', admin_activation_en='1. Paste the link into Chrome
2. If you are already logged in to Canva, a popup to join the team will appear automatically
3. If you are not logged in, clicking the link will direct you to the login page
4. After a successful login, you will be redirected automatically to the Canva team invitation' WHERE id=2 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:
- Head can invite 5 Members
- Plan: Gemini Pro
- Duration 14 - 15 Months
- Region Indonesia
- You get the account
- 1000 AI Flow Credits
- Include: Flow, Antigravity, Notebook LM, 5TB Storage

Usage rules:
- You must log in first from a phone, not a laptop/PC, because the Gmail will definitely be locked.', admin_activation_en='1. You must secure the account (password, recovery + 2fa)
2. You must clear all existing device sessions to avoid account lock
3. Warranty if backfree (excluding suspend / disable / inactive)
4. If asked to verify a number / OTP, just enter your personal phone number because every login on a new device almost certainly asks for OTP (it will not be saved to the Google account, only for device verification).
5. If Antigravity asks for verification: invite to the main email, then use the main email to log in to Antigravity' WHERE id=96 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:
- Duration directly 3 months
- Send Google email and password

Usage rules:
- Must be a Google account that has the 1-month free trial offer
- Must enable 2fa (tutorial will be provided later)

Warranty:
- Processed according to the queue; if there is an error, it will be refunded.', admin_activation_en='' WHERE id=99 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:

- Google AI Pro Head offer claim link; just open the link and click "Get Offer".
- Can be claimed using your own Google account, any account.
- After a successful claim, the account gets Google AI Pro access and can invite up to 5 family members.
- Gemini Pro plan with access to Flow, Antigravity, and NotebookLM.
- Includes 1,000 AI Flow credits per month.
- 5 TB storage. Personal files and data stay private and cannot be accessed by other members.
- This plan is a redeem link from the Jio promo program originating in India.
- Offer duration up to 18 months, but there is no guarantee the plan will stay active for the full 18 months. The active period still depends on Google''s policy and the event program organizer (JIO).

Process & delivery:

- The claim link will be sent by email and available on the order page after payment is verified.

Usage rules:

- Please redeem immediately after purchase; the link hold warranty is only 1 hour after purchase
- One link is valid for only one claim on one Google account and can invite up to 5 family members.
- Claim using your own Google account.

Warranty:

- The buyer must screen-record from before the link is opened until the claim process is complete, as proof if there is an issue.
- A link proven to be an error or expired before use receives a replacement warranty until a valid link is obtained.
- A link that has been used or a claim without screen-recording proof cannot be processed for warranty.
- Warranty only covers the validity of the link when received and before it is successfully claimed.
- After the link is successfully claimed, there is no warranty for the active period.
- Warranty does not cover the account returning to free / plan deactivation, or policy changes from Google or the program organizer.', admin_activation_en='1. Open the claim link we sent to your email and Order page
2. Log in using your own Google account
3. Click get offer then follow the steps until Pro status is active
4. The account is now Pro and can use all Google services in the Pro plan (Gemini, Antigravity, NotebookLM, Stitch, Flow)
5. Full video guide: /artikel/cara-redeem-google-ai-pro-setelah-order-di-axvara' WHERE id=101 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:
- Google AI Pro invitation to your personal email (sharing via invite)
- Gemini Pro plan with access to Flow, Antigravity, and NotebookLM
- 5 TB storage is shared
- Your storage content stays private and is not visible to other members
- Duration up to 18 months, but there is no guarantee the plan will stay active for the full 18 months. The active period still depends on Google''s policy and the event program organizer (JIO).

Process & delivery:
- Invitation is processed manually after payment is confirmed, 1-5 minutes

Usage rules:
- Make sure the email has never been registered in any Family Plan
- Previously joined another family? Leave first; if it still fails, you must use another email
- Can join and leave a family invite a maximum of 2x per year

Warranty:
- No warranty after the invitation is received in active condition
- No warranty for the account returning to free due to changed Google policy', admin_activation_en='1. Open the Google invitation email we sent to your email
2. Accept the family invitation with the same email
3. Wait for Pro status to become active; close the app and reopen it if it has not appeared' WHERE id=102 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:
- Account from the admin
- Duration 1 month
- 1 profile used by 2 users
- This variant may hit a screen limit if both users watch at the same time

Usage rules:
- Only 1 device

Warranty:
- Full warranty', admin_activation_en='How to log in:
1. HOW TO LOGIN = axvara.tech/go/netflix-login
2. BOT / CODE ACCESS = axvara.tech/go/otp
3. Before logging in, please delete the Netflix app data,
4. If logging in on a browser
5. Https://www.netflix.com/clearcookies
6. Then https://www.netflix.com/youraccount
7. If logging in on a phone
8. Reinstall the app / clear data

Terms:
1. Watch on your own profile!
2. Full warranty
3. Use on 1 device!
4. Do not tamper with the account!' WHERE id=124 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:
- Ready-to-use Muse AI account with 1 billion tokens
- Ready-to-use account, no need to register, no credit card, and no VPN.
- 1 Billion tokens can be used without a time limit
- Also gets a weekly quota of 100 million tokens

Warranty:
- 1x replacement warranty if the account is taken down
- Issue before entering the account? Contact the admin on WhatsApp/Telegram for help', admin_activation_en='1. Prepare the account email from the order details and the OTP access from the link provided at purchase
2. Open https://muse.ai and sign in using that account email
3. Get the login code from the OTP web, then enter it into Muse
4. The account is ready to use' WHERE id=248 AND admin_terms_en IS NULL;
UPDATE product_variants SET admin_terms_en='Package details:
- Google AI Pro, 3-month trial after successful activation.
- Gemini PRO + Argon model support in Antigravity.
- 5 TB cloud storage.
- Official Google redeem link for your own account.
- This variant requires payment verification such as funds / gopay / shopeepay and credit / debit card.
- Verification is still RP. 0 and can be cancelled immediately after the subscription is active
- Order + activation tutorial: https://youtu.be/dnw5rnpAkWw

Process & delivery:
- The link is sent by email and available on the order page after payment is verified.

Usage rules:
- IMPORTANT: do not open or try the activation link with a random email.
- After the link is opened and the Start Free Trial / Subscribe button is pressed, the offer may be tied to that Google account and cannot be used again with another email, even if activation fails.
- Use the link only on the Google account you actually want to activate. Do not try with the wrong account. One link is for one account and one activation attempt only.
- The Google account must meet the offer requirements (eligible). Not every account, including existing customers, is guaranteed to qualify.
- If "This account is not eligible" appears, stop the activation process.
- If the account is eligible, continue the steps until filling in the payment method.
- Check the automatic renewal terms and cancel if you do not want to continue after the trial ends.

Warranty:

- A link already used for testing or tried with the wrong account does not qualify for warranty.
- Problem link claims must include a complete screen recording from start to finish of the redemption process.
- Link warranty does not cover the Pro plan active period after successful claim or Google policy changes such as model removal and others.
- Make sure to read all terms and check account eligibility before opening the activation link.
- The MANDATORY RECORD rule is not meant to make things difficult. It exists so both seller and buyer are comfortable in the transaction; please follow that rule! Without a complete VIDEO RECORD, problem link reports will not be entertained!', admin_activation_en='1. See the order + activation tutorial on AXVARA YT: https://youtu.be/dnw5rnpAkWw
2. Start screen recording, then open the activation link via phone or laptop.
3. Log in using the Google account you want to activate.
4. Check account eligibility and offer details before continuing. If "This account is not eligible" appears, stop the process.
5. If it meets the requirements, follow Google''s instructions by adding / selecting a payment method and completing activation. Continue recording until the redemption process is complete.

Tips:
- Check the automatic renewal terms and cancel if you do not want to continue after the trial ends.' WHERE id=252 AND admin_terms_en IS NULL;
