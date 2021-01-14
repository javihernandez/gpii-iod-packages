#!/bin/bash

build() {
  cat <<BUILD
{
  "packageData": "lang.$1.json",
  "installer": "../$2",
  "category": "languages"
}
BUILD
}

package() {
  name=$(grep "^$1: " lang-names)
  cat <<PACKAGE
{
  "name": "language.$1",
  "description": "Language for $name",
  "packageType": "appx",
  "appxPackageName": "Microsoft.LanguageExperiencePack$1",
  "uninstallTime": "never"
}
PACKAGE
}

pushd $(dirname $0)

for dir in langpacks/*/ ; do
  lang=$(basename $dir)
  echo lang: $lang
  [ -d $lang ] || mkdir $lang
  build $lang $dir/Microsoft.LanguageExp*17763*appx > $lang/build.json
  package $lang > $lang/lang.$lang.json
done

popd
