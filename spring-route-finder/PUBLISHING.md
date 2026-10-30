# Publishing to the VS Code Marketplace

Publisher for this extension: `LingCloud` (already created). `publisher` in
`package.json` must stay identical to it, and the extension ID is
`LingCloud.spring-route-finder`.

## Option A - upload the VSIX in the browser (no auth tooling)

This is the simplest path and needs no token, no Azure DevOps organization and no CLI
login.

1. Open <https://marketplace.visualstudio.com/manage/publishers/LingCloud>
2. Choose `New extension` then `Visual Studio Code`
3. Drag `spring-route-finder-<version>.vsix` into the upload area
4. Confirm the name, version and publisher, then press `Upload`

The extension is usually live within a few minutes at
`https://marketplace.visualstudio.com/items?itemName=LingCloud.spring-route-finder`.

## Option B - publish from the CLI with Entra ID

```bash
npx @vscode/vsce publish --azure-credential
```

Important: `--azure-credential` does **not** open a browser. It resolves credentials from
this chain, in order:

```
EnvironmentCredential -> AzureCliCredential -> ManagedIdentityCredential
  -> AzurePowerShellCredential -> AzureDeveloperCliCredential
```

So you need an existing local credential first, for example the Azure CLI:

```bash
az login
npx @vscode/vsce publish --azure-credential
```

Without one of those credentials the command appears to hang while it tries each provider
and times out.

## Option C - publish from the CLI with a Personal Access Token

A PAT is created in Azure DevOps, so this requires an Azure DevOps organization. Creating
a new organization now requires linking an Azure subscription, which is why this path is
blocked for accounts without one.

If you do have an organization:

1. Open <https://dev.azure.com> and enter the organization
2. User settings -> `Personal access tokens` -> `New Token`
3. `Organization`: **All accessible organizations**
4. `Scopes`: `Custom defined`, then `Marketplace` -> **Manage** only
5. Copy the token (it is shown once) and use it:

```bash
export VSCE_PAT=<token>
npx @vscode/vsce publish
```

`vsce login LingCloud` stores the token in the native credential store instead, after
which plain `vsce publish` works.

## Packaging locally

```bash
npm install
npm test                                        # parser unit tests
npm run test:e2e                                # real extension host (downloads VS Code once)
npx @vscode/vsce package
```

The source repository is <https://github.com/lingcloud522/spring-route-finder>, declared in
the `repository` field, so no extra flags are needed.

## After a release

- Every release needs a higher `version`; the same version cannot be uploaded twice.
- The extension ID is fixed once published. Changing `publisher` creates a brand new
  extension and existing users will not migrate.
- `vsce delete <publisher>.<name>@<version>` removes a single version;
  `vsce unpublish <publisher>.<name>` takes the whole extension down (statistics are lost).
- To publish the same package to Open VSX (VSCodium, Cursor and others), use
  `npx ovsx publish` with an Open VSX token.

## Notes

- Marketplace policy requires disclosing any telemetry. This extension collects nothing
  and makes no network requests.
- The name uses the `Spring` trademark, which belongs to VMware. Third-party extensions
  commonly do this, but a trademark complaint would require renaming; renaming does not
  change the extension ID.

## Publishing to Open VSX (Cursor, VSCodium, Windsurf)

Cursor does not read the Microsoft Marketplace. Its documentation states that it resolves
third-party extensions from the Open VSX registry and then runs its own malware and
supply-chain analysis before offering them. So an extension that is live on the Microsoft
Marketplace still will not appear in Cursor until the same package is published to
Open VSX.

Since the registry moved under the Eclipse Foundation, publishing requires an Eclipse
account and a signed Publisher Agreement. Logging in with GitHub alone is no longer
enough, and the registry answers with "You must log in with an Eclipse Foundation account
and sign a Publisher Agreement before publishing any extension."

1. Register an Eclipse account at <https://accounts.eclipse.org/user/register>. Fill in
   the GitHub Username field with exactly the same GitHub account you use to sign in to
   open-vsx.org, otherwise the two identities will not line up.
2. Sign in at <https://open-vsx.org> with GitHub, open
   <https://open-vsx.org/user-settings/profile> and click `Log in with Eclipse`, then
   authorize. A `Show Publisher Agreement` button appears on that page: read the text to
   the end and press `Agree`. The Eclipse Contributor Agreement (ECA) is a different
   document and is not needed here.
3. Generate an access token at <https://open-vsx.org/user-settings/tokens>.
4. Create the namespace, which must match the `publisher` field (`LingCloud`), then upload
   the same VSIX that goes to the Microsoft Marketplace:

```bash
npx ovsx create-namespace LingCloud -p <token>   # only once
npx ovsx verify-pat LingCloud -p <token>         # optional sanity check
npx ovsx publish spring-route-finder-0.1.4.vsix -p <token> --skip-duplicate
```

Things worth knowing:

- Open VSX and the Microsoft Marketplace are separate accounts, namespaces and version
  histories. Each release has to be uploaded to both to reach both ecosystems.
- Publishing runs automated scanning: secret detection, blocklist comparison and
  namespace similarity. A rejection names the check that failed.
- Creating a namespace does not make you a verified owner; claiming the namespace is a
  separate step if you want the verified badge.
- Cursor's additional analysis can delay the extension showing up in its search, so a
  freshly published Open VSX release is not instant there.
- In the meantime users can install the VSIX by hand: Extensions view -> `...` ->
  `Install from VSIX...`.

## Claiming the namespace on Open VSX

After the first upload the extension page may show:

> Namespace not verified - LingCloud already exists in another gallery, so this extension
> stays inactive until the namespace is claimed and ownership verified.

Creating a namespace only makes you a contributor; it has no owner, and because the name
matches a publisher in another gallery the published extension stays inactive until the
claim is approved. Ownership is granted publicly through an issue:
<https://github.com/EclipseFdn/open-vsx.org/issues/new/choose> -> `Claim namespace ownership`.

Requirements before you file it:

- The GitHub account filing the request needs at least 12 months of public history.
- The namespace must not be owned by anyone else yet.
- Pick exactly one verification option and tick its evidence line.

The options, and how they map to this project:

1. **VS Code Publisher with Repo** - the namespace is also a Marketplace publisher and has
   an extension there whose `package.json` declares a `repository`, owned by the same
   GitHub identity (or you supply a commit URL from that public repo). This is the
   smoothest route and is now available: the repository exists and is public, so push the
   source, publish a Marketplace version that declares it, then tick this option and paste
   a commit URL as evidence.
2. **VS Code Publisher without Repo** - the namespace is a Marketplace publisher whose
   extensions have no GitHub repos. Verify by granting the Open VSX administrator ID
   `46461f8e-a0a8-6de8-9186-8ac72e28656d` temporary reader access to the Marketplace
   publisher account (revoke it once the issue is closed). DNS TXT record or a matching
   domain email also work if the namespace is a domain you own.
3. **Not a VS Code Marketplace Publisher** - matches a GitHub ID you control, or a domain
   you own.
4. **All other cases** - accepted, but the slowest to process.

While the claim is pending the extension is not offered on Open VSX, which also means it
will not appear in Cursor.
