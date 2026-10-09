# Releasing Ride to TestFlight

[`Ride release`](../.github/workflows/ride-release.yml) archives Ride for iOS (with the watch app
inside) and macOS, signs it, and uploads both to App Store Connect. They appear in TestFlight once
Apple has processed them, which takes a few minutes.

Signing is cloud managed: the workflow gives `xcodebuild` an App Store Connect API key and lets
it create the distribution certificate and provisioning profiles, so no certificates or profiles
are stored in GitHub. The build number is the UTC time of the run (`yyMMddHHmm`), so it only ever
goes up.

## One-time setup

1. In [App Store Connect](https://appstoreconnect.apple.com/apps), create the app record for the
   bundle ID `com.trainstackhq.ride` on iOS and add macOS to it. The watch app
   (`com.trainstackhq.ride.watchkitapp`) ships inside the iOS app and needs no record of its own.
2. In Users and Access, open Integrations, then App Store Connect API, and create a team key with
   the App Manager role. Use Admin if Xcode reports that it cannot create the distribution
   certificate. Download the `.p8` file, which Apple lets you do once, and note the key ID and
   the issuer ID.
3. In the repository settings, create an environment named `testflight` and add three secrets:

   | Secret              | Value                                        |
   | ------------------- | -------------------------------------------- |
   | `ASC_KEY_ID`        | The key ID                                   |
   | `ASC_ISSUER_ID`     | The issuer ID                                |
   | `ASC_KEY_P8_BASE64` | `base64 -i AuthKey_XXXXXXXXXX.p8` (one line) |

   Paste the values straight into GitHub. Never put them in chat, files or command arguments.

4. Restrict the environment to the `main` branch and `ride-v*` tags, and require a reviewer if
   more than one person can push tags.

## Releasing

Tag the commit and push the tag:

```bash
git tag ride-v1.0.0
git push origin ride-v1.0.0
```

The tag sets the marketing version. To upload without tagging, run the workflow by hand from the
Actions tab, optionally giving a version.

Once a build shows up in TestFlight, answer the export compliance question (Ride uses only the
encryption built into iOS and macOS), add it to a group, and invite testers. Internal testers (up
to 100 people on the App Store Connect team) get it straight away. External testers need Apple's
beta review for the first build of each version.

## Known gaps

The workflow has not been run yet. Expect to fix small things on the first release, such as the
runner image, a missing capability on the app ID, or the role of the API key.
