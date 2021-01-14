# gpii-iod-packages

Packages and builder for gpii-iod.

## Usage

Run `node ./build.js`, with some of these options:

* `--keygen` - Generate the keypair (See *Key Generation*)
* `--keypass KEYPASS` - Specify the password for the key (always required).
* `--downloads DOWNLOAD_DIR` - Store any downloaded files to `DOWNLOAD_DIR` (default: `./download-cache`).
* `--output OUTPUT_DIR` - Where the packages are written to `OUTPUT_DIR` (deault: `./output`).
* `--packages PACKAGES_FILE` - The package list file (default: `packages-list.json5`).
* `--key KEYFILE` - Location of the private key (default:` ~/.gpii/iod-package-key`).
* `--pubkey PUBKEYFILE` - Location of the public key (default: `.pub` is added to `KEYFILE`).

`KEYPASS` can be:

* `file:password.txt`: Read the password from `password.txt`.
* `env:PASS_ENV`: Get the password from the `PASS_ENV` environment variable.
* `HELLO`: The password is `HELLO`.


### Key Generation

Packages are signed, so you need to generate a key pair:

    node ./build.js --keygen --keypass KEYPASS

This will create a pair in `~/.gpii`; `iod-package-key` and `iod-package-key.pub`.

It will also display the fingerprint, which is added to `siteconfig.json` in gpii-app.
(the fingerprint is also in `iod-package-key.pub`)

IOD will only install packages which are signed by the keys in the list.

```js
installOnDemand: {
    trustedKeys: {
        "stegru": "e9kdOkqRw9qQyWJyoR/cx/0IPsIYKo445sY1WgTl2XY="
    }
}
```

### Building

    node ./build.js --keypass KEYPASS

The package build files are read from `package-list.json5`, the packages are put in `./output`.

## Package build files

```json5
{
    // Package data file
    "packageData": "putty.json",
    // The installer to download. This is the package payload.
    "installer": "https://the.earth.li/~sgtatham/putty/latest/w32/putty-0.73-installer.msi"
}
```

See the jsdoc at https://github.com/stegru/universal/blob/GPII-2971/gpii/node_modules/gpii-iod/src/packages.js#L35
for the package data.

