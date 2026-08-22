# GitHub Pages deployment

The React application is published from the `dist/` production bundle by
`.github/workflows/deploy-pages.yml`. A push to `master` that changes the web
application starts a deployment. The workflow can also be run manually from
the repository's **Actions** tab.

The intended production URL is <https://paint.rip>. The Vite application is
built for the domain root (`/`), so asset URLs work directly on that custom
domain.

## Repository settings

The GitHub Pages site must use **GitHub Actions** as its build source and
`paint.rip` as its custom domain. These settings can be checked under
**Settings → Pages** in the `evgenyvinnik/pinta-online` repository.

GitHub Actions deployments do not use a checked-in `CNAME` file. The custom
domain is stored in the repository's Pages settings instead.

## Domain ownership verification

Verify `paint.rip` for the `evgenyvinnik` account before assigning it to the
repository. This protects the domain from Pages takeover and releases an old
Pages claim owned by another GitHub account:

1. Open the personal GitHub **Settings → Pages** page.
2. Under **Verified domains**, choose **Add a domain** and enter `paint.rip`.
3. Add the exact TXT record GitHub supplies to the domain's DNS zone.
4. Confirm propagation with
   `dig _github-pages-challenge-evgenyvinnik.paint.rip TXT`.
5. Return to the same GitHub page, choose **Continue verifying**, and verify
   the domain. Keep the TXT record after verification.

Once verification succeeds, set `paint.rip` under the repository's
**Settings → Pages → Custom domain** field.

## DNS records

Configure the DNS zone at the registrar or DNS provider for `paint.rip`.
Remove other `A`, `AAAA`, `ALIAS`, or `ANAME` records for the apex before
adding the GitHub Pages records; conflicting records can prevent certificate
issuance.

Required apex records:

| Type | Name | Value |
| --- | --- | --- |
| `A` | `@` | `185.199.108.153` |
| `A` | `@` | `185.199.109.153` |
| `A` | `@` | `185.199.110.153` |
| `A` | `@` | `185.199.111.153` |

GitHub also supports these optional IPv6 records:

| Type | Name | Value |
| --- | --- | --- |
| `AAAA` | `@` | `2606:50c0:8000::153` |
| `AAAA` | `@` | `2606:50c0:8001::153` |
| `AAAA` | `@` | `2606:50c0:8002::153` |
| `AAAA` | `@` | `2606:50c0:8003::153` |

To make `www.paint.rip` redirect to the primary domain, add:

| Type | Name | Value |
| --- | --- | --- |
| `CNAME` | `www` | `evgenyvinnik.github.io` |

Do not use a wildcard DNS record for the domain.

## Verification

After DNS propagation, check the records:

```bash
dig +short paint.rip A
dig +short paint.rip AAAA
dig +short www.paint.rip CNAME
```

The four GitHub Pages addresses should be returned for the apex. In the
repository's **Settings → Pages**, wait for the DNS check and TLS certificate
to complete, then enable **Enforce HTTPS**. Certificate provisioning can take
up to an hour after DNS is correct.

Finally, verify both endpoints:

```bash
curl --fail --head https://paint.rip
curl --fail --head https://www.paint.rip
```

The first request should return the site and the second should redirect to
`https://paint.rip` when the optional `www` record is configured.
