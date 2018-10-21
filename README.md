[![NPM version](https://badge.fury.io/js/ts-project-loader.svg)](https://www.npmjs.com/package/ts-project-loader)

ts-project-loader
==========

A TypeScript file loader for webpack, using TypeScript project (tsconfig.json). This loader provides the compiled (transpiled) JS files (from TS files) to webpack process, to bundle TypeScript files as webpack modules.

ts-project-loader compiles all TypeScript files in the project on the request only for the first TS file, not for each TS files. Because the TypeScript compilation is executed only once (per project and compiler instance), this will reduce total compilation time a little.

ts-project-loader is based on `tsc2webpack` project, and is more easier-to-use because ts-project-loader is simply a webpack loader.

## Install

ts-project-loader requires typescript (version: >= 2.7) and webpack (version: 4.x; might run with 3.x but not tested fully).

```
npm install -D typescript webpack ts-project-loader
```

## Usage

Before using `ts-project-loader`, construct TypeScript project with `tsconfig.json`. Zero configuration is supported but not recommended.

To use with webpack configuration, add `ts-project-loader` as a loader for TypeScript files (\*.ts / \*.tsx).

```js
    ...
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: [
                    {
                        loader: 'ts-project-loader'
                    }
                ]
            }
        ]
    }
```

From webpack command-line, specify `--module-bind ts=ts-project-loader`.

### Options

You can specify following options into the fields of `options` object. (All options are optional.)

```js
    use: [
        {
            loader: 'ts-project-loader',
            options: { /* following options come here */ }
        }
    ]
```

#### configFile, configFileName (string)

Specifies the TypeScript project file (such as tsconfig.json) or the directory path.
If omitted, tsconfig.json will be searched from the directory of input TypeScript file.

`declaration` option is supported. If `declarationDir` is not specified, the declaration files (\*\.d\.ts) will be emitted to the output directory of webpack.

NOTE: `outDir` compiler option of `tsconfig.json` is ignored. `sourceMap` compiler option is overridden by webpack configuration.

#### tempBuildDir (string)

Specifies the temporal output directory for emitted JS files from TypeScript compiler. If not specified, JS files will not be emitted.

#### locale (string)

Specifies the language (locale) for TypeScript compiler messages. (Currently other messages are outputted in English.)

#### logger (object)

Specifies the logger object to output logs. Following methods can be specified (all methods are optional):

* `logInfo(message: string, details?: any): void`
  * Called when an usual log message is outputted.
* `logVerbose(message: string, details?: any): void`
  * Called when a verbose log message is outputted.

By default, internal `logInfo` method is used and verbose messages are ignored.

#### silent (boolean)

Suppress logs from the loader. If true, the methods in `logger` are not called.

#### showVersion (boolean)

Outputs the loader version on the first initialization. Ignored if `silent` is true.

#### useTsModuleResolution (boolean)

Specifies `true` if using module resolution method from TypeScript only. By default, the loader uses `enhanced-resolve` with webpack configuration for module resolution.

#### compilerOptions (object)

Additional compiler options for TypeScript files. This overrides the options in the config file.

NOTE: For the purpose of this loader, you cannot specify additional options per files; otherwise an unexpected behavior may occur.

## Notes

* Internal instances of ts-project-loader are created per config files (such as tsconfig.json) to reduce compilation count. If input TypeScript file belongs to different project (config file), another instance will be created and the TS files will be compiled.
  * If `configFile` or `configFileName` is specified, and input TypeScript file does not belong to the project, the TS file will **not be compiled**.
* If watch mode is enabled (by webpack configuration), ts-project-loader will execute TypeScript compilation as watch mode, which enables incremental build (in this mode, re-compilation process is optimized by TypeScript compiler).
* ts-project-loader is a regular loader, so you can chain other loaders such as `babel-loader`.

## License

MIT License
