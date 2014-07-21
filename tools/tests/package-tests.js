var selftest = require('../selftest.js');
var Sandbox = selftest.Sandbox;
var files = require('../files.js');
var testUtils = require('../test-utils.js');
var utils = require('../utils.js');
var _= require('underscore');
var fs = require("fs");

var testPackagesServer = "https://test-packages.meteor.com";
process.env.METEOR_PACKAGE_SERVER_URL = testPackagesServer;

var username = "test";
var password = "testtest";


// Given a sandbox, that has the app as its currend cwd, read the packages file
// and check that it contains exactly the packages specified, in order.
//
// sand: a sandbox, that has the main app directory as its cwd.
// packages: an array of packages in order. Packages can be of the form:
//
//    standard-app-packages (ie: name), in which case this will match any
//    version of that package as long as it is included.
//
//    awesome-pack@1.0.0 (ie: name@version) to match that name at that
//    version explicitly. This is for packages that we included at a specific
//    version.
var checkPackages = function(sand, packages) {
  var lines = sand.read(".meteor/packages").split("\n");
  var i = 0;
  _.each(lines, function(line) {
    if (!line) return;
    // If the specified package contains an @ sign, then it has a version
    // number, so we should match everything.
    if (packages[i].split('@').length > 1) {
      selftest.expectEqual(line, packages[i]);
    } else {
      var pack = line.split('@')[0];
      selftest.expectEqual(pack, packages[i]);
    }
    i++;
  });
  selftest.expectEqual(packages.length, i);
};

// Given a sandbox, that has the app as its currend cwd, read the versions file
// and check that it contains the packages that we are looking for. We don't
// check the order, we just want to make sure that the right dependencies are
// in.
//
// sand: a sandbox, that has the main app directory as its cwd.
// packages: an array of packages in order. Packages can be of the form:
//
//    standard-app-packages (ie: name), in which case this will match any
//    version of that package as long as it is included. This is for packages
//    external to the app, since we don't want this test to fail when we push a
//    new version.
//
//    awesome-pack@1.0.0 (ie: name@version) to match that name at that
//    version explicitly. This is for packages that only exist for the purpose
//    of this test (for example, packages local to this app), so we know exactly
//    what version we expect.
var checkVersions = function(sand, packages) {
  var lines = sand.read(".meteor/versions").split("\n");
  var depend = {};
  _.each(lines, function(line) {
    if (!line) return;
    // Packages are stored of the form foo@1.0.0, so this should give us an
    // array [foo, 1.0.0].
    var split = line.split('@');
    var pack = split[0];
    depend[pack] = split[1];
  });
  var i = 0;
  _.each(packages, function (pack) {
    var split = pack.split('@');
    if (split.length > 1) {
      selftest.expectEqual(depend[split[0]], split[1]);
    } else {
      var exists = _.has(depend, split[0]);
      selftest.expectEqual(exists, true);
    }
    i++;
  });
  selftest.expectEqual(packages.length, i);
};

// Add packages to an app. Change the contents of the packages and their
// dependencies, make sure that the app still refreshes.
selftest.define("change packages", function () {
  var s = new Sandbox();
  var run;

  // Starting a run
  s.createApp("myapp", "package-tests");
  s.cd("myapp");
  s.set("METEOR_TEST_TMP", files.mkdtemp());
  run = s.run();
  run.waitSecs(5);
  run.match("myapp");
  run.match("proxy");
  run.match("MongoDB");
  run.waitSecs(5);
  run.match("your app");
  run.waitSecs(5);
  run.match("running at");
  run.match("localhost");
  // Add the local package 'say-something'. It should print a message.
  s.write(".meteor/packages", "standard-app-packages \n say-something");
  run.waitSecs(3);
  run.match("initial");
  run.match("restarted");

  // Modify the local package 'say'something'.
  s.cd("packages/say-something", function () {
    s.write("foo.js", "console.log(\"another\");");
  });
  run.waitSecs(12);
  run.match("another");
  run.match("restarted");

  // Add a local package depends-on-plugin.
  s.write(".meteor/packages", "standard-app-packages \n depends-on-plugin");
  run.waitSecs(2);
  run.match("foobar");
  run.match("restarted");

  // Change something in the plugin.
  s.cd("packages/contains-plugin/plugin", function () {
    s.write("plugin.js", "console.log(\"edit\");");
  });
  run.waitSecs(2);
  run.match("edit");
  run.match("foobar!");
  run.match("restarted");

  // In a local package, add a dependency on a different package.  In this case,
  // package2.js contains an onUse call that tells it to use accounts-base (a
  // core package that is not already included in the app)
  s.cp('packages/contains-plugin/package2.js',
         'packages/contains-plugin/package.js');
  run.waitSecs(2);
  run.match("edit");
  run.match("foobar!");
  run.match("restarted");

  // Add packages to sub-programs of an app. Make sure that the correct change
  // is propagated to its versions file.
  s.cp('programs/empty/package2.js', 'programs/empty/package.js');

  run.waitSecs(2);
  run.match("restarted");

});


// Add packages through the command line, and make sure that the correct set of
// changes is reflected in .meteor/packages, .meteor/versions and list
selftest.define("add packages", function () {
  var s = new Sandbox();
  var run;

  // Starting a run
  s.createApp("myapp", "package-tests");
  s.cd("myapp");
  s.set("METEOR_TEST_TMP", files.mkdtemp());
  s.set("METEOR_OFFLINE_CATALOG", "t");

  run = s.run("add", "accounts-base");

  run.match("Successfully added");
  checkPackages(s,
                ["standard-app-packages", "accounts-base"]);

  run = s.run("--once");

  run = s.run("add", "say-something@1.0.0");
  run.match("Successfully added");
  run.match("say-something: print to console");

  checkPackages(s,
                ["standard-app-packages", "accounts-base",  "say-something@1.0.0"]);

  run = s.run("add", "depends-on-plugin");
  run.match("Successfully added");
  checkPackages(s,
                ["standard-app-packages", "accounts-base",
                 "say-something@1.0.0", "depends-on-plugin"]);

  checkVersions(s,
                ["accounts-base",  "depends-on-plugin",
                 "say-something",  "standard-app-packages",
                 "contains-plugin@1.1.0"]);

  run = s.run("remove", "say-something");
  run.match("Removed constraint say-something");
  checkVersions(s,
                ["accounts-base",  "depends-on-plugin",
                 "standard-app-packages",
                 "contains-plugin"]);

  run = s.run("remove", "depends-on-plugin");
  run.match("removed dependency on contains-plugin");
  run.match("Removed constraint depends-on-plugin");

  checkVersions(s,
                ["accounts-base",
                 "standard-app-packages"]);
  run = s.run("list");
  run.match("standard-app-packages");
  run.match("accounts-base");

  // Add packages to sub-programs of an app. Make sure that the correct change
  // is propagated to its versions file.
  s.cp('programs/empty/package2.js', 'programs/empty/package.js');

  // Don't add the file to packages.
  run = s.run("list");
  run.match("standard-app-packages");
  run.match("accounts-base");

  // Do add the file to versions.
  checkVersions(s,
                ["accounts-base",  "depends-on-plugin",
                 "standard-app-packages",
                 "contains-plugin"]);

  // Add a description-less package. Check that no weird things get
  // printed (like "added no-description: undefined").
  run = s.run("add", "no-description");
  run.match("Successfully added the following packages.\n");
  run.read("no-description\n");
  run.expectEnd();
  run.expectExit(0);
});

// Removes the local data.json file from disk.
var cleanLocalCache = function () {
  var config = require("../config.js");
  var storage =  config.getPackageStorage();
  fs.unlinkSync(storage);
};

// Add packages through the command line, and make sure that the correct set of
// changes is reflected in .meteor/packages, .meteor/versions and list
selftest.define("sync",  function () {
  var s = new Sandbox();
  var run;

  s.set("METEOR_TEST_TMP", files.mkdtemp());
  testUtils.login(s, username, password);
  var packageName = utils.randomToken();
  var fullPackageName = username + ":" + packageName;
  var releaseTrack = username + ":TEST-" + utils.randomToken().toUpperCase();
  var run;

  // First test -- pretend that the user has downloaded meteor for the purpose
  // of running a package or an app. Create a package and an app. Clean out the
  // data.json, then try to do things with them.

  // Publish the most basic package.
  run = s.run("create", "--package", fullPackageName);
  run.waitSecs(15);
  run.expectExit(0);
  run.match(fullPackageName);

  s.cd(fullPackageName, function () {
    run = s.run("publish", "--create");
    run.waitSecs(15);
    run.expectExit(0);
    run.match("Done");
  });

  // Publish a release.  This release is super-fake: the tool is a package that
  // is not actually a tool, for example. That's OK for our purposes for now.
  var packages = {};
  packages[fullPackageName] = "1.0.0";
  var relConf = { track: releaseTrack, version:"0.9",
    recommended: "true",
    description: "a test release",
    tool: fullPackageName + "@1.0.0",
    packages: packages
  };
  s.write("release.json", JSON.stringify(relConf, null, 2));
  run = s.run("publish-release", "release.json", "--create-track");
  run.waitSecs(15);
  run.match("Done");

  // Create a package that has a versionsFrom for the just-published release.
  var newPack = fullPackageName + "2";
  s.createPackage(newPack, "package-of-two-versions");
  s.cd(newPack, function() {
    var packOpen = s.read("package.js");
    packOpen = packOpen + "\nPackage.onUse(function(api) { \n" +
      "api.versionsFrom(\"" + releaseTrack + "@0.9\");\n" +
      "api.use(\"" + fullPackageName + "\"); });";
    s.write("package.js", packOpen);
  });

  // Clear the local data cache.
 // cleanLocalCache();

  // Try to publish the package.
  s.cd(newPack, function() {
    run = s.run("publish", "--create");
    run.waitSecs(15);
    run.match("Done");
  });

  // Make an app.
  //cleanLocalCache();
  run = s.run("create", "testApp");
  run.waitSecs(10);
  run.expectExit(0);

  // Add one of our packages to it, then run it.
 // cleanLocalCache();
  s.cd("testApp", function () {
    run = s.run("add", newPack);
    run.waitSecs(5);
    run.match("Successfully added");
    run.expectExit(0);

    // Run the app!
    run = s.run();
    run.waitSecs(15);
    run.match("running at");
    run.match("localhost");
    run.stop();

     // Clear cache; run again!
  //  cleanLocalCache();
    run = s.run();
    run.waitSecs(15);
    run.match("running at");
    run.match("localhost");
    run.stop();
  });



});
