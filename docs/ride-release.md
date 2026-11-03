# Releasing Ride

[`Ride release`](../.github/workflows/ride-release.yml) archives Ride for iOS (with the watch app
inside) and macOS, signs it, and uploads both to App Store Connect. They appear in TestFlight once
Apple has processed them, which takes a few minutes. It also publishes the Mac app for Homebrew,
as below.

Ride is on Richard's Homebrew tap in two channels:

```sh
brew install --cask richard-better/tap/trainstack-ride        # named releases
brew install --cask richard-better/tap/trainstack-ride@alpha  # every push to main
```

Both come from [`Ride Homebrew`](../.github/workflows/ride-homebrew.yml), which imports the
Developer ID certificate into a throwaway keychain and builds the Mac app with it through
`apps/ride/scripts/build-notarized.sh`, notarizes and staples it, and
publishes `Ride-<version>.zip` and `SHA256SUMS` as the GitHub release `ride-v<version>`. It then
starts the tap's update workflow, which checks the checksum and moves the cask on. Named releases
are marked latest. [`Ride alpha`](../.github/workflows/ride-alpha.yml) publishes every push to
`main` that touches Ride as the prerelease `<marketing>-alpha.<build>`, and keeps the ten newest.
Developer ID builds cannot hold Sign in with Apple, so they sign in through Apple's web flow; see
[Sign in with Apple on the web](deployment.md#sign-in-with-apple-on-the-web).

App Store signing is cloud managed: the workflow gives `xcodebuild` an App Store Connect API key
and lets it create the distribution certificate and provisioning profiles. Apple's cloud signing
will not issue a Developer ID certificate to an API key, even an Admin one, so the Homebrew build
signs with the team's Developer ID certificate from GitHub and only makes its profile with the key. The build number is the UTC time of the run (`yyMMddHHmm`), so it only ever
goes up.

## One-time setup

1. In [App Store Connect](https://appstoreconnect.apple.com/apps), create the app record for the
   bundle ID `com.trainstackhq.ride` on iOS and add macOS to it. The watch app
   (`com.trainstackhq.ride.watchkitapp`) ships inside the iOS app and needs no record of its own.
2. In Users and Access, open Integrations, then App Store Connect API, and create a team key with
   the Admin role. Cloud signing needs it: with App Manager, the run fails with
   `Cloud signing permission error`. Download the `.p8` file, which Apple lets you do once, and note the key ID and
   the issuer ID.
3. In the repository settings, create an environment named `testflight` and add three secrets:

   | Secret              | Value                                        |
   | ------------------- | -------------------------------------------- |
   | `ASC_KEY_ID`        | The key ID                                   |
   | `ASC_ISSUER_ID`     | The issuer ID                                |
   | `ASC_KEY_P8_BASE64` | `base64 -i AuthKey_XXXXXXXXXX.p8` (one line) |

   Paste the values straight into GitHub. Never put them in chat, files or command arguments.

   Add the Developer ID certificate as two more secrets. In Keychain Access, open My
   Certificates, export `Developer ID Application: Richard Borcsik (S64PDPJKMJ)` with its private
   key as a `.p12` with a password, then send both straight to GitHub and delete the file:

   ```sh
   base64 -i DeveloperID.p12 | gh secret set DEVELOPER_ID_P12_BASE64 --env testflight --repo richard-better/trainstack
   gh secret set DEVELOPER_ID_P12_PASSWORD --env testflight --repo richard-better/trainstack
   rm DeveloperID.p12
   ```

   The second command prompts for the password. The certificate expires in September 2031.

   Add `HOMEBREW_TAP_TOKEN`: a fine-grained personal access token for
   `richard-better/homebrew-tap` only, with read and write access to Actions. It lets the
   workflows start the tap's update.

4. Restrict the environment to the `main` branch, and require a reviewer if more than one person
   can push there.

## Releasing

Run `Ride release` from the Actions tab on `main` with the marketing version, such as `0.1.1`:

```bash
gh workflow run ride-release.yml --repo richard-better/trainstack -f version=0.1.1
```

The release creates the tag `ride-v0.1.1` itself. Alphas need nothing: merging to `main` publishes
one.

Once a build shows up in TestFlight, answer the export compliance question (Ride uses only the
encryption built into iOS and macOS), add it to a group, and invite testers. Internal testers (up
to 100 people on the App Store Connect team) get it straight away. External testers need Apple's
beta review for the first build of each version.

## Known gaps

The first release run got through App Store signing, and App Store Connect's validation then
caught two Info.plist mistakes, which `apps/ride/scripts/check-store-info.sh` now checks on every
CI build. Signing the Homebrew build with the imported Developer ID certificate has not run yet.
