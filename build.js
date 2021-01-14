/*
 * IoD package builder
 *
 * Copyright 2019 Raising the Floor - International
 *
 * Licensed under the New BSD license. You may not use this file except in
 * compliance with this License.
 *
 * The R&D leading to these results received funding from the
 * Department of Education - Grant H421A150005 (GPII-APCP). However,
 * these results do not necessarily represent the policy of the
 * Department of Education, and you should not assume endorsement by the
 * Federal Government.
 *
 * You may obtain a copy of the License at
 * https://github.com/GPII/universal/blob/master/LICENSE.txt
 */

"use strict";

var fluid = fluid || require("gpii-iod");
var gpii = fluid.registerNamespace("gpii");

var parseArgs = require("minimist"),
    fs = require("fs"),
    path = require("path"),
    glob = require("glob"),
    JSON5 = require("json5"),
    os = require("os"),
    crypto = require("crypto"),
    request = require("request"),
    mkdirp = require("mkdirp");

console.log("\n");

var config = {
    // Build packages even if they're already up to date.
    force: false,
    // The package source directory.
    source: "./packageSource",
    // The package output directory
    output: "./output",
    // The installer downloads directory
    downloads: "./download-cache",
    // package list file
    packages: "package-list.json5",
    key: path.join(os.homedir(), ".gpii/iod-package-key"),
    keygen: false
};

var argOptions = {
    default: config,
    string: Object.keys(config).filter(function (key) {
        return typeof(config[key]) === "string";
    }),
    boolean: Object.keys(config).filter(function (key) {
        return typeof(config[key]) === "boolean";
    })
};

config = parseArgs(process.argv.slice(2), argOptions);

config.output = path.resolve(config.output);
config.downloads = path.resolve(config.downloads);
config.key = path.resolve(config.key);
config.pubkey = path.resolve(config.pubkey || (config.key + ".pub"));
config.packages = findFile(config.packages, correctJsonFile("packageSource/package-list.json5"));

if (config.keygen) {
    generateKey();
} else {
    buildPackages().then(function (localPackageData) {
        var content;
        content = "/* Morphic Install on Demand package info (" + new Date().toISOString() + ") */\n";
        content += JSON5.stringify({packages: localPackageData}, null, "  ");
        fs.writeFileSync(path.join(config.output, ".morphic-packages"), content);
    });
}

/**
 * Checks if the key files specified on the command line exist.
 * @return {Object} Object containing privateKey and publicKey booleans to signify each file exists. null if none do.
 */
function checkKeys() {
    var togo = {};
    if (fs.existsSync(config.key)) {
        togo.privateKey = true;
    }
    if (fs.existsSync(config.pubkey)) {
        togo.publicKey = true;
    }

    return (togo.privateKey || togo.publicKey) ? togo : null;
}

/**
 * Generates a key pair, saves it in ~/.gpii/iod-package-key and ~/.gpii/iod-package-key.pub (or whatever --key states)
 */
function generateKey() {

    var keysFound = checkKeys();
    if (keysFound) {
        console.error("A key already exists (" + config.key + ").");
        console.error("Before generating a new one, think about what you're doing.");
        process.exit(1);
    }

    if (!config.keypass) {
        config.keypass = "";
    }

    // Take the passphrase from an environment variable (eg, --keypass=env:KEY_PASS)
    if (config.keypass.startsWith("env:")) {
        var env = config.keypass.substr(4);
        console.log("Using environment variable '" + env + "' for key passphrase.");
        config.keypass = process.env[env] || "";
    }

    // Take the passphrase from inside a file (eg, --keypass=file:passwd.txt)
    if (config.keypass.startsWith("file:")) {
        var file = path.resolve(config.keypass.substr(5));
        console.log("Using file '" + file + "' for key passphrase.");
        config.keypass = fs.readdirSync(file, "utf8");
    }

    if (!config.keypass || config.keypass === "") {
        console.error("No key passphrase given: use --keypass.");
        process.exit(1);
    }

    console.log("Generating key pair...");
    // similar to: openssl genrsa -out key.pem -aes128 -passout pass:something 4096
    var keyPair = crypto.generateKeyPairSync("rsa", {
        modulusLength: 4096,
        publicKeyEncoding: {
            type: "spki",
            format: "pem"
        },
        privateKeyEncoding: {
            type: "pkcs1",
            format: "pem",
            cipher: "aes-128-cbc",
            passphrase: config.keypass
        }
    });

    var dir = path.dirname(config.key);
    mkdirp.sync(dir);

    // Generate the fingerprint of the public key
    var keyBuffer = gpii.iodServer.packageFile.readPEM(keyPair.publicKey);
    var fingerprint = crypto.createHash("sha256").update(keyBuffer).digest("base64");

    // Put it in the public key file (for humans)
    keyPair.publicKey = "Fingerprint=sha256:" + fingerprint + "\n\n" + keyPair.publicKey;

    // Save them
    var privateFile = config.key;
    var publicFile = config.key + ".pub";
    console.log("Writing private key to:", privateFile);
    fs.writeFileSync(privateFile, keyPair.privateKey, {mode: parseInt("0600", 8)});
    console.log("Writing public key to:", publicFile);
    fs.writeFileSync(publicFile, keyPair.publicKey);

    console.log("Public key fingerprint (this is for the site-config): ", fingerprint);
}

/**
 * Builds the packages.
 * @return {Promise} Resolves when complete.
 */
function buildPackages() {

    var keyExists = checkKeys();
    if (!keyExists || !keyExists.publicKey || !keyExists.privateKey) {
        console.error("Key pair files do not exist: '" + config.key + "' and '" + config.pubkey + "'.");
        console.error("Generate using --keygen, or specify using --key.");
        process.exit(1);
    }

    /** @type Key */
    var key = {
        key: fs.readFileSync(config.key),
        publicKey: fs.readFileSync(config.pubkey),
        passphrase: config.keypass
    };

    var buildFiles = [];
    var packageList;
    if (config.packages) {
        packageList = JSON5.parse(fs.readFileSync(correctJsonFile(config.packages), "utf8"));
        var baseDir = path.dirname(config.packages);
        fluid.each(packageList.build, function (item) {
            var files = glob.sync(item, {
                cwd: baseDir,
                absolute: true
            }).filter(function (file) { return !file.includes(".ignore"); });
            buildFiles.push.apply(buildFiles, files);
        });
    }

    console.log("Found ", buildFiles.length, "packages to build");

    if (buildFiles.length === 0) {
        console.log("No packages specified.");
        process.exit(1);
    }

    mkdirp.sync(config.output);

    var promise = fluid.promise();

    var packagesTodo = loadBuildInfo(buildFiles);
    // Information used when loading packages locally
    var localPackageInfo = {};

    var buildNext = function () {
        var current = packagesTodo.shift();
        if (current) {
            build(current, key).then(function (packageFile) {
                // Read the file for some information for the local package data
                current.output = packageFile;
                getLocalPackageData(packageFile).then(function (info) {
                    localPackageInfo[info.name] = info;
                    buildNext();
                });
            });
        } else {
            promise.resolve(localPackageInfo);
        }
    };

    buildNext();

    return promise;
}

/**
 * Reads a package file for some information to put in the local package data file.
 * @param {String} packageFile The package file.
 * @return {Promise<LocalPackage>} Resolves when complete.
 */
function getLocalPackageData(packageFile) {
    var promise = fluid.promise();
    gpii.iodServer.packageFile.read(packageFile).then(function (packageFileInfo) {
        var result = {
            name: packageFileInfo.packageData.name,
            packageFile: path.relative(config.output, packageFileInfo.path),
            packageData: packageFileInfo.packageDataJson,
            packageDataSignature: packageFileInfo.signature.toString("base64")
        };

        if (packageFileInfo.header.installerLength) {
            result.installer = result.packageFile;
            result.offset = packageFileInfo.header.installerOffset;
        }
        promise.resolve(result);
    });
    return promise;
}

/**
 * Returns a file with either .json or .json5 extension, depending on which one exists. If both or neither exist,
 * then the original file is returned.
 * @param {String} file The filename to check.
 * @return {String} The filename with the corrected extension.
 */
function correctJsonFile(file) {

    var result = file;
    if (!fs.existsSync(file)) {
        // Swap the .json5/.json extension
        var newFile;
        if (file.endsWith(".json")) {
            newFile = file + "5";
        } else if (file.endsWith(".json5")) {
            newFile = file.substr(0, file.length - 1);
        }

        if (newFile && fs.existsSync(newFile)) {
            result = newFile;
        }
    }
    return result;
};

/**
 * @typedef BuildInfo {Object}
 * @property {String} dir The directory containing the build and packageData json files.
 * @property {String} packageData [optional] The packageData.json file.
 * @property {String} packageOutput [optional] Name of the package file created.
 * @property {String} name [optional] The name of the package (value in packageData will override this)
 * @property {String} installer [optional] Installer file name (or the url to download from).
 * @property {String} category [optional] Subdirectory of the output directory to put the package file in.
 */

/**
 * Loads the build info for the packages to be built.
 *
 * @param {Array<String>} buildFiles The build.json/json5 files.
 * @return {Array<Object>} The package data for each package. Dies on error.
 */
function loadBuildInfo(buildFiles) {
    var togo = [];

    fluid.each(buildFiles, function (buildFile) {
        console.log("Loading", buildFile);
        /** @type BuildInfo */
        var buildInfo = JSON5.parse(fs.readFileSync(buildFile, "utf8"));
        var dir = path.dirname(buildFile);


        buildInfo.packageData = correctJsonFile(path.resolve(dir, buildInfo.packageData));

        /** @type PackageData */
        var packageData = fluid.freezeRecursive(JSON5.parse(fs.readFileSync(buildInfo.packageData, "utf8")));
        if (!packageData.name) {
            console.error("Package data file does not contain a 'name' field: ", packageData);
            process.exit(1);
        }

        buildInfo.name = packageData.name;
        buildInfo.dir = dir;
        buildInfo.packageDataObject = packageData;
        buildInfo.packageOutput = path.join(
            config.output, "packages", buildInfo.category || "", buildInfo.name + ".morphic-package");

        togo.push(buildInfo);
    });

    return togo;
};

/**
 * Builds a package.
 * @param {BuildInfo} buildInfo The package build information.
 * @param {Key} key The private and public key pair used to sign the package.
 * @return {Promise} Resolves when complete, dies on error.
 */
function build(buildInfo, key) {
    console.log("Building package '" + buildInfo.name + "'");

    // Download the installer, if it's a URL.
    var installer;
    if (buildInfo.installer && buildInfo.installer.match(/^https?:\/\//)) {
        mkdirp.sync(config.downloads);
        var downloadTo = path.resolve(config.downloads, buildInfo.name + "-installer");

        if (fs.existsSync(downloadTo)) {
            console.log("Using cached installer download for: ", buildInfo.installer);
            installer = downloadTo;
        } else {
            console.log("Downloading installer from: " + buildInfo.installer);
            installer = fileDownload(buildInfo.installer, downloadTo).then(function (result) {
                console.log("Downloaded installer to:", result);
            }, function (err) {
                console.error("Error downloading", buildInfo.installer, err);
                process.exit(1);
            });
        }
    } else {
        installer = path.resolve(buildInfo.dir, buildInfo.installer);
    }

    // Create the package file
    var promiseTogo = fluid.promise();
    fluid.toPromise(installer).then(function (installerFile) {
        mkdirp.sync(path.dirname(buildInfo.packageOutput));
        gpii.iodServer.packageFile.create(buildInfo.packageDataObject, installerFile, key, buildInfo.packageOutput).then(function () {
            console.log("Built package '" + buildInfo.name + "':", buildInfo.packageOutput);
            promiseTogo.resolve(buildInfo.packageOutput);
        }, function (err) {
            console.error("Failed building package '" + buildInfo.name + "':", err, buildInfo);
            process.exit(1);
        });
    });

    return promiseTogo;
};

/**
 * Download a file/
 * @param {String} url The URL.
 * @param {String} saveAs The destination file.
 * @return {Promise} Resolves when complete.
 */
function fileDownload(url, saveAs) {
    var promise = fluid.promise();

    var req = request.get({
        url: url
    });

    req.on("error", function (err) {
        promise.reject({
            isError: true,
            message: "Unable to download package: " + err.message,
            url: url,
            error: err
        });
    });

    req.on("response", function (response) {
        if (response.statusCode === 200) {
            var output = fs.createWriteStream(saveAs);
            output.on("finish", function () {
                promise.resolve(saveAs);
            });
            response.pipe(output);
        } else {
            promise.reject({
                isError: true,
                message: "Unable to download package: " + response.statusCode + " " + response.statusMessage,
                url: url
            });
        }
    });

    return promise;
};

/**
 * Returns the first file in the arguments list that exists.
 * @param {...String} var-args The paths to check.
 * @return {String} The first file in the arguments list that exists, or undefined.
 */
function findFile() {
    for (var i = 0; i < arguments.length; i++) {
        if (fs.existsSync(arguments[i])) {
            return arguments[i];
        }
    }
}
