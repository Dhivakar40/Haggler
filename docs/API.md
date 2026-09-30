# Haggler API

> Generated from the code by `pnpm openapi`. Do not edit by hand; CI fails if it drifts.
> Machine-readable spec: [openapi.json](./openapi.json). Live UI at `/docs` when the API runs.

| Method | Path | Summary |
| --- | --- | --- |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe; also reports which adapters are sandbox vs live |
| POST | `/v1/admin/auth/login` | Admin sign-in (email + password). 5 wrong attempts per email locks it for 15 minutes. |
| GET | `/v1/admin/campus-listings` | Browse Campus listings; q searches the title (Phase 8, D-059) |
| POST | `/v1/admin/campus-listings/{id}/cancel` | Take down a fraudulent or abusive Campus listing |
| GET | `/v1/admin/contract-listings` | Browse Contract listings; q searches the title (Phase 8, D-059) |
| POST | `/v1/admin/contract-listings/{id}/cancel` | Take down a fraudulent or abusive Contract listing |
| POST | `/v1/admin/employers/{id}/verify` | Confirm this is a real business (unlocks Campus listings for them) |
| GET | `/v1/admin/employers/queue` | Unverified employers, oldest first (Phase 7 gate for Campus listings, D-062) |
| GET | `/v1/admin/kyc/{id}` | One verification with short-lived image links. Each view is audit-logged. |
| POST | `/v1/admin/kyc/{id}/decision` | Approve, reject (reason required) or request more information |
| GET | `/v1/admin/kyc/queue` | KYC review queue, oldest first, cursor-paginated |
| GET | `/v1/admin/me` | Who am I (admin) |
| GET | `/v1/admin/reviews` | Reviews, newest first; filter to one person with revieweeId (Phase 8, D-049) |
| POST | `/v1/admin/reviews/{id}/hide` | Hide a fraudulent or abusive review (reverses its rating out of the aggregate) |
| POST | `/v1/auth/logout` | End this session (revokes the refresh token family). Always succeeds. |
| POST | `/v1/auth/otp/send` | Send a 6-digit code by SMS. Limits: 30 s between codes, 5/hour per phone, 20/hour per IP. |
| POST | `/v1/auth/otp/verify` | Verify the code. Creates the account on first sign-in and returns a session. |
| POST | `/v1/auth/refresh` | Exchange a refresh token for a new pair. The old refresh token stops working. |
| GET | `/v1/campus` | Browse open Campus listings |
| GET | `/v1/campus/{id}` | Listing detail |
| POST | `/v1/campus/{id}/apply` | Apply to a listing (opt into night shifts explicitly if it has any) |
| DELETE | `/v1/campus/{id}/apply` | Withdraw my application |
| GET | `/v1/categories` | List active service categories (public) |
| GET | `/v1/contracts` | Browse open Contract-labour listings |
| GET | `/v1/contracts/{id}` | Listing detail |
| POST | `/v1/contracts/{id}/apply` | Apply to a listing |
| DELETE | `/v1/contracts/{id}/apply` | Withdraw my application |
| POST | `/v1/employer/campus` | Post a Campus (part-time student) listing — needs a verified employer |
| GET | `/v1/employer/campus` | My Campus listings, newest first |
| PATCH | `/v1/employer/campus/{id}` | Edit a listing, or change its status (pause/reopen/close/cancel) |
| GET | `/v1/employer/campus/{id}/applications` | Every applicant for one of my Campus listings |
| POST | `/v1/employer/campus/{id}/applications/{appId}/decision` | Shortlist, reject or hire an applicant (re-checks the weekly hours cap on hire) |
| POST | `/v1/employer/campus/{id}/boost` | Pay a Boosted Listing fee for higher placement (D-069): creates a payment order |
| POST | `/v1/employer/contracts` | Post a Contract-labour listing |
| GET | `/v1/employer/contracts` | My listings, newest first |
| PATCH | `/v1/employer/contracts/{id}` | Edit a listing, or change its status (pause/reopen/close/cancel) |
| GET | `/v1/employer/contracts/{id}/applications` | Every applicant for one of my listings |
| POST | `/v1/employer/contracts/{id}/applications/{appId}/decision` | Shortlist, reject or hire an applicant |
| POST | `/v1/employer/contracts/{id}/boost` | Pay a Boosted Listing fee for higher placement (D-069): creates a payment order |
| GET | `/v1/employer/profile` | My employer profile |
| PATCH | `/v1/employer/profile` | Set or update my business name |
| GET | `/v1/jobs` | My jobs (as customer and/or Ranger), newest first, cursor-paginated |
| GET | `/v1/jobs/{id}` | One job with everything I am allowed to see |
| POST | `/v1/jobs/{id}/arrive` | Ranger: I have arrived. Needs GPS within the geofence; generates the customer's 4-digit code. |
| POST | `/v1/jobs/{id}/cancel` | Cancel the job (either party, until work starts). Fee flag only if the Ranger already travelled far. |
| POST | `/v1/jobs/{id}/complete` | Ranger: work finished (needs an after photo). Records how the customer will pay. |
| POST | `/v1/jobs/{id}/confirm` | Customer: confirm the work is done |
| POST | `/v1/jobs/{id}/en-route` | Ranger: on my way (after the price is agreed) |
| POST | `/v1/jobs/{id}/offers` | Make an offer (or counter). Max 3 rounds; outside the price band both sides must confirm. |
| POST | `/v1/jobs/{id}/photos` | Ranger: presigned upload for the BEFORE (required to start) or AFTER (required to finish) photo |
| POST | `/v1/jobs/{id}/photos/{photoId}/confirm` | Ranger: confirm a job photo upload |
| POST | `/v1/jobs/{id}/report-no-show` | Report a no-show after the grace period (customer: Ranger; Ranger: customer) |
| POST | `/v1/jobs/{id}/review` | Leave a review for the other party (once, only once the job is confirmed complete) |
| GET | `/v1/jobs/{id}/reviews` | Both reviews for this job, and whether I can/did review |
| POST | `/v1/jobs/{id}/share-link` | Customer: create a 12-hour live-trip link for a trusted contact |
| POST | `/v1/jobs/{id}/share-link/revoke` | Customer: revoke all live-trip links for this job |
| POST | `/v1/jobs/{id}/start` | Ranger: start work. Needs the arrival code verified and a before photo. |
| GET | `/v1/jobs/{id}/thread` | The chat thread for this job |
| GET | `/v1/jobs/{id}/track` | Live location and trail of the Ranger while the job is active |
| POST | `/v1/jobs/{id}/verify-arrival` | Ranger: enter the 4-digit code the customer reads out (max 5 tries) |
| POST | `/v1/kyc/documents` | Get a presigned URL (valid 5 min) to upload one document straight to private storage |
| POST | `/v1/kyc/documents/{id}/confirm` | Confirm that the upload finished; verifies the file exists at the declared size |
| POST | `/v1/kyc/start` | Open a tier 1 (identity) or tier 2 (go-live) verification. Needs KYC consent. |
| GET | `/v1/kyc/status` | My verification tier and the state of each check, including reviewer messages |
| POST | `/v1/kyc/submit` | Submit the verification for admin review (tier 2 also needs a reference) |
| GET | `/v1/me` | My account, roles and any consents I still need to give |
| PATCH | `/v1/me` | Update my name and languages |
| DELETE | `/v1/me` | Request account deletion. Sessions end now; data is erased after a 30-day grace period. |
| GET | `/v1/me/addresses` | My saved addresses |
| POST | `/v1/me/addresses` | Save an address. Send latitude+longitude from the phone GPS, or we try to geocode it. |
| PATCH | `/v1/me/addresses/{id}` | Edit one of my addresses |
| DELETE | `/v1/me/addresses/{id}` | Delete one of my addresses |
| GET | `/v1/me/blocks` | People I have blocked |
| POST | `/v1/me/blocks` | Block someone: they will never be matched with me again, in either direction |
| DELETE | `/v1/me/blocks/{userId}` | Unblock someone |
| GET | `/v1/me/campus-applications` | My own Campus applications, newest first |
| GET | `/v1/me/consents` | My consent history |
| POST | `/v1/me/consents` | Give consent for a purpose at the current legal version |
| DELETE | `/v1/me/consents/{purpose}` | Withdraw consent for a purpose |
| GET | `/v1/me/contract-applications` | My own Contract-labour applications, newest first |
| GET | `/v1/me/emergency-contacts` | My emergency contacts (used by SOS and live-trip sharing) |
| POST | `/v1/me/emergency-contacts` | Add an emergency contact (max 5) |
| PATCH | `/v1/me/emergency-contacts/{id}` | Edit an emergency contact |
| DELETE | `/v1/me/emergency-contacts/{id}` | Remove an emergency contact |
| GET | `/v1/me/export` | Download all data we hold about me (DPDP access right) |
| PATCH | `/v1/me/push-token` | Register this device's push notification token (Phase 5) |
| POST | `/v1/me/roles` | Add a role (Customer, Ranger or Employer). Student arrives with Haggler Campus. |
| POST | `/v1/offers/{id}/accept` | Accept the other party's offer; the job becomes AGREED at that price |
| POST | `/v1/offers/{id}/counter` | Counter-offer (next round) |
| POST | `/v1/offers/{id}/reject` | Reject the offer: ends the negotiation and cancels the job |
| GET | `/v1/plus/membership` | My current Haggler Plus membership, or null if never subscribed |
| GET | `/v1/plus/plans` | Haggler Plus plans. Filter with audience=CUSTOMER|EMPLOYER (D-069) |
| GET | `/v1/price-bands` | Price band (min/median/max, integer paise) for a category and area |
| GET | `/v1/rangers/{id}/reviews` | A Ranger's review history from customers, newest first |
| POST | `/v1/requests` | Create a service request. Immediate requests start broadcasting to nearby Rangers at once. |
| GET | `/v1/requests/{id}` | A request/job as seen by me (customer or matched Ranger) |
| POST | `/v1/requests/{id}/accept` | Ranger: accept a request. First accept wins; everyone else gets 409 REQUEST_TAKEN. |
| POST | `/v1/requests/{id}/cancel` | Cancel a request that has not been matched yet |
| POST | `/v1/requests/{id}/decline` | Ranger: decline a request |
| POST | `/v1/requests/{id}/rebroadcast` | Try again after a timeout: invites Rangers from wave 1 again |
| POST | `/v1/requests/{id}/rush` | Pay a Rush fee to skip wave sequencing on this request (D-069): creates a payment order |
| POST | `/v1/requests/media` | Get a presigned URL to upload a request photo (max 5) or a voice note (max 60 s) |
| POST | `/v1/requests/media/{mediaId}/confirm` | Confirm that a media upload finished |
| GET | `/v1/student/profile` | My student profile |
| POST | `/v1/student/profile` | Set my date of birth once (hard-blocked under 18) and my institute name |
| PATCH | `/v1/student/profile` | Update my institute name (the date of birth cannot be changed here) |
| GET | `/v1/threads/{id}/messages` | Messages, newest first, cursor-paginated |
| POST | `/v1/threads/{id}/messages` | Send a message (idempotent on clientMsgId). The WebSocket event chat.message does the same. |
| GET | `/v1/track/{token}` | Live trip link contents: status and the Ranger's position. No phone numbers. |
| GET | `/v1/wallet` | My token balance, held tokens, and the last 20 ledger entries |
| GET | `/v1/wallet/bundles` | Purchasable token bundles, discounted if I have an active Haggler Plus membership |
| GET | `/v1/wallet/orders` | My purchase history (top-ups, Plus, rush, boosts), newest first |
| POST | `/v1/wallet/orders/{orderId}/sandbox-pay` | Dev/test only: complete a sandbox order instantly (refused when PAYMENTS_MODE=test) |
| POST | `/v1/wallet/orders/{orderId}/verify` | Verify Razorpay Checkout's success callback and apply the order's effect (idempotent). Works for any order purpose — top-up, Plus, rush fee, boosted listing. |
| POST | `/v1/wallet/plus/subscribe` | Start a Haggler Plus subscription: creates a payment order (D-069) |
| POST | `/v1/wallet/topup` | Start a top-up: creates a payment order for a token bundle |
| GET | `/v1/worker/incoming` | Requests currently waiting for my answer (use after reconnecting) |
| POST | `/v1/worker/location` | Location heartbeat (every 5-10 s). While on a job it also extends the GPS trail and pushes to the customer. |
| POST | `/v1/worker/offline` | Go offline: no new requests |
| POST | `/v1/worker/online` | Go online (needs verification level 2 and at least one category). Sends the first location. |
| GET | `/v1/worker/presence` | Am I online right now (heartbeat fresh)? |
| GET | `/v1/worker/profile` | My Ranger profile (verification tier, categories, bio) |
| PATCH | `/v1/worker/profile` | Update my Ranger profile and the categories I work in (max 5) |
