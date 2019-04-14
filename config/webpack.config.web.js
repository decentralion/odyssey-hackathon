// @flow
const express = require("express");
/*::
import type {
  $Application as ExpressApp,
  $Response as ExpressResponse,
} from "express";
import type {RepoIdRegistry} from "../src/core/repoIdRegistry";
*/
const fs = require("fs");
const os = require("os");
const path = require("path");
const webpack = require("webpack");
const RemoveBuildDirectoryPlugin = require("./RemoveBuildDirectoryPlugin");
const CopyPlugin = require("copy-webpack-plugin");
const ManifestPlugin = require("webpack-manifest-plugin");
const StaticSiteGeneratorPlugin = require("static-site-generator-webpack-plugin");
const ModuleScopePlugin = require("react-dev-utils/ModuleScopePlugin");
const paths = require("./paths");
const getClientEnvironment = require("./env");

// Source maps are resource heavy and can cause out of memory issue for large source files.
const shouldUseSourceMap = process.env.GENERATE_SOURCEMAP !== "false";

function loadRepoRegistry() /*: RepoIdRegistry */ {
  const env = process.env.SOURCECRED_DIRECTORY;
  // TODO(#945): de-duplicate finding the directory with src/cli/common.js
  const defaultDirectory = path.join(os.tmpdir(), "sourcecred");
  const scDirectory = env != null ? env : defaultDirectory;
  // TODO(@dandelion): Remove hacks around compat usage here
  // TODO(@dandelion): Import rather than hardcode the registry file name
  const registryFile = path.join(scDirectory, "repositoryRegistry.json");

  let jsonString;
  try {
    jsonString = fs.readFileSync(registryFile).toString();
  } catch (e) {
    if (e.code === "ENOENT") {
      jsonString = JSON.stringify([
        {version: "0.2.0", type: "REPO_ID_REGISTRY"},
        [],
      ]);
    } else {
      throw e;
    }
  }
  const json = JSON.parse(jsonString);
  const compat = json[0];
  if (compat.version !== "0.2.0" || compat.type !== "REPO_ID_REGISTRY") {
    throw new Error("Compat mismatch");
  }
  return json[1];
}
const repoRegistry = loadRepoRegistry();

// Get environment variables to inject into our app.
const env = getClientEnvironment(repoRegistry);

function makeConfig(mode /*: "production" | "development" */) /*: mixed */ {
  return {
    // Don't attempt to continue if there are any errors.
    bail: true,
    // We generate sourcemaps in production. This is slow but gives good results.
    // You can exclude the *.map files from the build during deployment.
    devtool: shouldUseSourceMap ? "source-map" : false,
    // In production, we only want to load the polyfills and the app code.
    entry: {
      main: [require.resolve("./polyfills"), paths.appIndexJs],
      ssr: [
        require.resolve("./polyfills"),
        paths.appServerSideRenderingIndexJs,
      ],
    },
    devServer: {
      inline: false,
      before: (app /*: ExpressApp */) => {
        const apiRoot = "/api/v1/data";
        const rejectCache = (_unused_req, res /*: ExpressResponse */) => {
          res.status(400).send("Bad Request: Cache unavailable at runtime\n");
        };
        app.get(`${apiRoot}/cache`, rejectCache);
        app.get(`${apiRoot}/cache/*`, rejectCache);
        app.use(
          apiRoot,
          express.static(
            process.env.SOURCECRED_DIRECTORY ||
              path.join(os.tmpdir(), "sourcecred")
          )
        );
      },
    },
    output: {
      // The build folder.
      path: paths.appBuild,
      // Generated JS file names (with nested folders).
      // There will be one main bundle, and one file per asynchronous chunk.
      // We don't currently advertise code splitting but Webpack supports it.
      filename: "static/js/[name].[chunkhash:8].js",
      chunkFilename: "static/js/[name].[chunkhash:8].chunk.js",
      // Point sourcemap entries to original disk location (format as URL on Windows)
      devtoolModuleFilenameTemplate: (
        info /*:
        {|
          // https://webpack.js.org/configuration/output/#output-devtoolmodulefilenametemplate
          +absoluteResourcePath: string,
          +allLoaders: string,
          +hash: string,
          +id: string,
          +loaders: string,
          +resource: string,
          +resourcePath: string,
          +namespace: string,
        |}
        */
      ) =>
        path
          .relative(paths.appSrc, info.absoluteResourcePath)
          .replace(/\\/g, "/"),
      // We need to use a UMD module to build the static site.
      libraryTarget: "umd",
    },
    resolve: {
      // This allows you to set a fallback for where Webpack should look for modules.
      // We placed these paths second because we want `node_modules` to "win"
      // if there are any conflicts. This matches Node resolution mechanism.
      // https://github.com/facebookincubator/create-react-app/issues/253
      modules: [
        "node_modules",
        paths.appNodeModules,
        ...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
      ],
      // These are the reasonable defaults supported by the Node ecosystem.
      // We also include JSX as a common component filename extension to support
      // some tools, although we do not recommend using it, see:
      // https://github.com/facebookincubator/create-react-app/issues/290
      // `web` extension prefixes have been added for better support
      // for React Native Web.
      extensions: [".web.js", ".mjs", ".js", ".json", ".web.jsx", ".jsx"],
      alias: {
        // Support React Native Web
        // https://www.smashingmagazine.com/2016/08/a-glimpse-into-the-future-with-react-native-for-web/
        "react-native": "react-native-web",
      },
      plugins: [
        // Prevents users from importing files from outside of src/ (or node_modules/).
        // This often causes confusion because we only process files within src/ with babel.
        // To fix this, we prevent you from importing files out of src/ -- if you'd like to,
        // please link the files into your node_modules/ and let module-resolution kick in.
        // Make sure your source files are compiled, as they will not be processed in any way.
        new ModuleScopePlugin(paths.appSrc, [paths.appPackageJson]),
      ],
    },
    module: {
      strictExportPresence: true,
      rules: [
        // TODO: Disable require.ensure as it's not a standard language feature.
        // We are waiting for https://github.com/facebookincubator/create-react-app/issues/2176.
        // { parser: { requireEnsure: false } },
        {
          // "oneOf" will traverse all following loaders until one will
          // match the requirements. When no loader matches it will fall
          // back to the "file" loader at the end of the loader list.
          oneOf: [
            // "url" loader works just like "file" loader but it also embeds
            // assets smaller than specified size as data URLs to avoid requests.
            {
              test: [/\.bmp$/, /\.gif$/, /\.jpe?g$/, /\.png$/],
              loader: require.resolve("url-loader"),
              options: {
                limit: 10000,
                name: "static/media/[name].[hash:8].[ext]",
              },
            },
            // Process JS with Babel.
            {
              test: /\.(js|jsx|mjs)$/,
              include: paths.appSrc,
              loader: require.resolve("babel-loader"),
              options: {
                compact: true,
              },
            },
            {
              test: /\.css$/,
              loader: "css-loader", // TODO(@wchargin): add csso-loader
            },
            {
              test: /\.scss$/,
              use: [
                "style-loader",
                {
                  loader: "css-loader",
                  options: {
                    camelCase: true,
                    sourceMap: true,
                    localIdentName: "[local]___[hash:base64:5]",
                  },
                },
                "sass-loader",
              ],
            },
            {
              test: /\.svg$/,
              exclude: /node_modules/,
              loader: "svg-react-loader",
            },
            // "file" loader makes sure assets end up in the `build` folder.
            // When you `import` an asset, you get its filename.
            // This loader doesn't use a "test" so it will catch all modules
            // that fall through the other loaders.
            {
              loader: require.resolve("file-loader"),
              // Exclude `js` files to keep "css" loader working as it injects
              // it's runtime that would otherwise processed through "file" loader.
              // Also exclude `html` and `json` extensions so they get processed
              // by webpacks internal loaders.
              exclude: [/\.(js|jsx|mjs)$/, /\.html$/, /\.json$/],
              options: {
                name: "static/media/[name].[hash:8].[ext]",
              },
            },
            // ** STOP ** Are you adding a new loader?
            // Make sure to add the new loader(s) before the "file" loader.
          ],
        },
      ],
    },
    plugins: plugins(mode),
    // Some libraries import Node modules but don't use them in the browser.
    // Tell Webpack to provide empty mocks for them so importing them works.
    node: {
      dgram: "empty",
      fs: "empty",
      net: "empty",
      tls: "empty",
      child_process: "empty",
    },
  };
}

function plugins(mode /*: "development" | "production" */) {
  const basePlugins = [
    new StaticSiteGeneratorPlugin({
      entry: "ssr",
      paths: require("../src/homepage/routeData")
        .makeRouteData(repoRegistry)
        .map(({path}) => path),
      locals: {},
    }),
    new CopyPlugin([{from: paths.favicon, to: "favicon.png"}]),
    // Makes some environment variables available to the JS code, for example:
    // if (process.env.NODE_ENV === 'production') { ... }. See `./env.js`.
    // It is absolutely essential that NODE_ENV was set to production here.
    // Otherwise React will be compiled in the very slow development mode.
    new webpack.DefinePlugin(env.stringified),
    // Generate a manifest file which contains a mapping of all asset filenames
    // to their corresponding output file so that tools can pick it up without
    // having to parse `index.html`.
    new ManifestPlugin({
      fileName: "asset-manifest.json",
    }),
    // Moment.js is an extremely popular library that bundles large locale files
    // by default due to how Webpack interprets its code. This is a practical
    // solution that requires the user to opt into importing specific locales.
    // https://github.com/jmblog/how-to-optimize-momentjs-with-webpack
    // You can remove this if you don't use Moment.js:
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
  ];
  const prodOnlyPlugins = [
    // Remove the output directory before starting the build.
    new RemoveBuildDirectoryPlugin(),
    // Minify the code.
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        warnings: false,
        // Disabled because of an issue with Uglify breaking seemingly valid code:
        // https://github.com/facebookincubator/create-react-app/issues/2376
        // Pending further investigation:
        // https://github.com/mishoo/UglifyJS2/issues/2011
        comparisons: false,
      },
      mangle: {
        safari10: true,
      },
      output: {
        comments: false,
        // Turned on because emoji and regex is not minified properly using default
        // https://github.com/facebookincubator/create-react-app/issues/2488
        ascii_only: true,
      },
      sourceMap: shouldUseSourceMap,
    }),
  ];
  switch (mode) {
    case "development":
      return basePlugins;
    case "production":
      return basePlugins.concat(prodOnlyPlugins);
    default:
      throw new Error(/*:: (*/ mode /*: empty) */);
  }
}

function getMode() {
  const mode = process.env.NODE_ENV;
  if (mode !== "production" && mode !== "development") {
    throw new Error("unknown mode: " + String(mode));
  }
  return mode;
}

module.exports = makeConfig(getMode());
