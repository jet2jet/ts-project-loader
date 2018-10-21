
import * as path from 'path';

import { getOptions, getRemainingRequest, OptionObject } from 'loader-utils';
import * as ts from 'typescript';
import * as webpack from 'webpack';

/** @internal */
import './webpack/types';

import Constants from './types/Constants';
import Handlers from './types/Handlers';
import Options from './types/Options';
import TscBuildConfig from './types/TscBuildConfig';
import TscBuildResult from './types/TscBuildResult';

import thisVersion from './version';

import {
	executeTsc,
	findConfigFile,
	loadConfigFile,
	watchTsc
} from './tsc';
import { isTsProjectSourceFile, convertTsFileNameToJs, getTsBasePath } from './utils/functions';
import { logInfo } from './utils/log';
import ReplaceWatchFileSystem from './webpack/ReplaceWatchFileSystem';

interface LoaderInstance {
	tscBuildConfig: TscBuildConfig;
	handlers: Handlers;
	compilers: webpack.Compiler[];
	fs?: webpack.InputFileSystem | null | undefined;
	buildPromise?: Promise<TscBuildResult>;
	watchStarted?: boolean;
}
interface Instances {
	[configName: string]: LoaderInstance;
}

// tslint:disable-next-line:no-empty-interface
interface LoaderOptions extends OptionObject, Options {
}

const allLoaderInstances: WeakMap<webpack.Compiler, Instances> = new WeakMap();
const thisNameHeader = `[${Constants.ThisName}] `;

function validateOptions(options: LoaderOptions) {
	if (options.configFile && options.configFileName) {
		throw new Error('Both \'configFile\' and \'configFileName\' cannot be specified');
	}
}

function getParseConfigHost(loader: webpack.loader.LoaderContext, currentDir: string): ts.ParseConfigHost & {
	directoryExists(name: string): boolean
} {
	const fs: webpack.InputFileSystem = loader.fs || loader._compiler.inputFileSystem;
	const useCaseSensitiveFileNames = true;
	return {
		useCaseSensitiveFileNames,
		fileExists(name) {
			try {
				return fs.statSync(name).isFile();
			} catch (_e) {
				return false;
			}
		},
		directoryExists(name) {
			try {
				return fs.statSync(name).isDirectory();
			} catch (_e) {
				return false;
			}
		},
		readDirectory(rootDir, extensions, excludes, includes, depth) {
			return (ts as any).matchFiles(
				rootDir,
				extensions,
				excludes,
				includes,
				useCaseSensitiveFileNames,
				currentDir,
				depth,
				getEntries
			);
		},
		readFile(file) {
			return fs.readFileSync(file).toString('utf8');
		}
	};

	function getEntries(fileName: string): {
		files: string[],
		directories: string[]
	} {
		try {
			const entries = fs.readdirSync(fileName || '.').sort();
			const files: string[] = [];
			const directories: string[] = [];
			for (const entry of entries) {
				if (entry === '.' || entry === '..') {
					continue;
				}
				let name: string;
				if (fs.join) {
					name = fs.join(fileName, entry);
				} else {
					name = path.join(fileName, entry);
				}
				let stat: any = void 0;
				try {
					stat = fs.statSync(name);
				} catch (_e) {
					continue;
				}
				if (stat.isFile()) {
					files.push(entry);
				} else if (stat.isDirectory()) {
					directories.push(entry);
				}
			}
			return { files: files, directories: directories };
		} catch (_e) {
			return {
				files: [],
				directories: []
			};
		}
	}
}

function makeHandlers(loader: webpack.loader.LoaderContext, loaderOptions: LoaderOptions): Handlers {
	const handleError = (_isWatching: boolean, message: string, error: Error) => {
		loader.emitError(error || message);
	};
	const logInfo = loaderOptions.silent ? void (0) :
		(loaderOptions.logger && loaderOptions.logger.logInfo && loaderOptions.logger.logInfo.bind(loaderOptions.logger) || (
			(message: string, _details?: any) => {
				console.info(`${thisNameHeader}${message}`);
			}
		));
	const logVerbose = loaderOptions.silent ? void (0) :
		(loaderOptions.logger && loaderOptions.logger.logVerbose && loaderOptions.logger.logVerbose.bind(loaderOptions.logger));
	return {
		handleError,
		logInfo,
		logVerbose
	};
}

function getInstance(
	loader: webpack.loader.LoaderContext,
	configPath: string | undefined
): LoaderInstance | undefined {
	const loaderInstances = allLoaderInstances.get(loader._compiler);
	return loaderInstances && loaderInstances[configPath || ''];
}

function setInstance(
	loader: webpack.loader.LoaderContext,
	configPath: string | undefined,
	instance: LoaderInstance
): LoaderInstance {
	let loaderInstances = allLoaderInstances.get(loader._compiler);
	if (!loaderInstances) {
		loaderInstances = {};
		allLoaderInstances.set(loader._compiler, loaderInstances);
	}
	loaderInstances[configPath || ''] = instance;
	return instance;
}

function setupInstance(loader: webpack.loader.LoaderContext, options: LoaderOptions) {
	const resourcePath = loader.resourcePath;
	const rootContext = loader.rootContext || ((loader as any).options || {}).context || process.cwd();
	const host = getParseConfigHost(loader, rootContext);
	const configFile: string | undefined = options.configFile || options.configFileName;
	const configPath = findConfigFile(
		(name) => host.directoryExists(name),
		(name) => host.fileExists(name),
		path.dirname(resourcePath),
		configFile
	);
	let instance = getInstance(loader, configPath);
	if (!instance) {
		const handlers = makeHandlers(loader, options);
		if (options.showVersion) {
			logInfo(handlers, `${Constants.ThisName} version ${thisVersion}`);
		}
		if (!configPath) {
			logInfo(handlers, `Using default configuration`);
		} else {
			logInfo(handlers, `Using tsconfig file: '${configPath}'`);
		}
		const tscBuildConfig = loadConfigFile(
			host,
			configPath,
			rootContext,
			loader.sourceMap,
			(loader._compiler.options.resolve || {}) as any,
			options.useTsModuleResolution,
			options.tempBuildDir,
			options.compilerOptions
		);
		const fs = tscBuildConfig.wrappedFs && tscBuildConfig.wrappedFs.makeInputFileSystem(
			loader.fs,
			tscBuildConfig
		);
		instance = setInstance(loader, configPath, {
			tscBuildConfig, handlers, fs, compilers: []
		});
	}
	const wrappedFs = instance.tscBuildConfig.wrappedFs;
	if (
		wrappedFs &&
		!wrappedFs.isInputFileSystemWrapped(loader.fs)
	) {
		loader.fs = instance.fs!;
		if (loader._compiler) {
			loader._compiler.inputFileSystem = instance.fs!;
		}
	}
	return instance;
}

function installWatcher(
	compiler: webpack.Compiler,
	tscBuildResult: TscBuildResult
) {
	(compiler as any).watchFileSystem = new ReplaceWatchFileSystem(
		(compiler as any).watchFileSystem,
		tscBuildResult,
		tscBuildResult.data.compilerOptions.outDir!
	);
}

function runTsc(
	instance: LoaderInstance,
	compiler: webpack.Compiler
): Promise<TscBuildResult> {
	// if compilation is already executed, simply returns generated Promise object
	if (instance.buildPromise) {
		return instance.buildPromise;
	}
	if (compiler.options.watch) {
		const makePromise = () => {
			let resolver: (value: TscBuildResult) => void;
			const promise = new Promise<TscBuildResult>((resolve) => {
				resolver = resolve;
			});
			return {
				promise, resolver: resolver!
			};
		};
		const defer = makePromise();
		instance.buildPromise = defer.promise;
		const r = watchTsc(
			// startRebuild
			() => {
				// re-create Promise object to wait for the rebuild
				const p = makePromise();
				instance.buildPromise = p.promise;
				// return resolver to pass to finishBuild
				return p.resolver;
			},
			// finishBuild
			(resolver) => {
				instance.watchStarted = true;
				// resolver is undefined on the first compilation
				if (resolver) {
					resolver(r);
				}
			},
			instance.tscBuildConfig,
			instance.handlers
		);
		const exit = () => {
			if (r.watchInstance) {
				r.watchInstance!.stop();
			}
		};
		if (compiler.hooks) {
			compiler.hooks.watchClose.tap('ts-project-loader', exit);
		} else {
			compiler.plugin('watch-close', exit);
		}
		defer.resolver(r);
	} else {
		instance.buildPromise = Promise.resolve().then(
			() => {
				try {
					return Promise.resolve(executeTsc(instance.tscBuildConfig, instance.handlers));
				} catch (e) {
					return Promise.reject(e);
				}
			}
		);
	}
	return instance.buildPromise;
}

function makeSourceMap(
	jsSource: string,
	sourceMapText: string,
	originalInput: any,
	tsFileName: string,
	loader: webpack.loader.LoaderContext
) {
	return {
		output: jsSource.replace(/^\/\/# sourceMappingURL=[^\r\n]*/mg, ''),
		sourceMap: Object.assign(JSON.parse(sourceMapText), {
			sources: [getRemainingRequest(loader)],
			file: tsFileName,
			sourcesContent: [originalInput]
		})
	};
}

function getWebpackOutputPath(compiler: webpack.Compiler) {
	const conf = compiler.options || {};
	return ((compiler as any).outputPath as (string | undefined)) || (conf.output && conf.output.path);
}

function emitDeclarationFile(
	loader: webpack.loader.LoaderContext,
	compilation: webpack.compilation.Compilation,
	tscBuildResult: TscBuildResult
) {
	const outputPath = getWebpackOutputPath(compilation.compiler) ||
		'./dist';
	// console.info('** Start emit declarations');
	tscBuildResult.data.files.forEach((tsFile) => {
		// generate original .d.ts file
		const basePath = getTsBasePath(tscBuildResult);
		const pathObject = path.parse(path.relative(basePath, tsFile));
		delete pathObject.base;
		pathObject.name += '.d';
		let dtsFile: string;
		let assetName: string;
		const wrappedFs = tscBuildResult.wrappedFs;
		const tscOutDir = tscBuildResult.data.compilerOptions.outDir!;
		if (!tscBuildResult.data.compilerOptions.declarationDir && wrappedFs && wrappedFs.isWrappedFsPath(tscOutDir)) {
			const p = wrappedFs.joinPath(tscOutDir, path.format(pathObject));
			dtsFile = wrappedFs.resolvePath(p);
			// make dummy dts file path to calculate relative name
			// (when declarationDir is not defined, the output path is based on 'basePath')
			const relativeName = wrappedFs.relativePath(tscOutDir, dtsFile);
			const dummyDtsFile = path.join(basePath, relativeName);
			assetName = path.relative(outputPath, dummyDtsFile);
			// console.info('**** dtsFile:', dtsFile, ', assetName:', assetName);
		} else {
			dtsFile = path.resolve(
				basePath,
				tscBuildResult.data.compilerOptions.declarationDir || tscOutDir,
				path.format(pathObject)
			);
			// asset name should be relative path from outputPath
			assetName = path.relative(outputPath, dtsFile);
		}
		//console.info(dtsFile);
		if (compilation.assets[assetName]) {
			return;
		}
		try {
			const buffer = (loader.fs as webpack.InputFileSystem).readFileSync(dtsFile) as (Buffer | string);
			const content = typeof buffer === 'string' ? buffer : buffer.toString('utf8');
			compilation.assets[assetName] = {
				source: () => content,
				size: () => content.length
			};
		} catch (_e) {
			// do nothing
		}
	});
}

function waitTime(milliSec: number) {
	return new Promise<void>((resolve) => {
		(ts.sys.setTimeout || setTimeout)(resolve, milliSec);
	});
}

export default function loader(this: webpack.loader.LoaderContext, input: any, inputMap: any) {
	this.cacheable && this.cacheable();

	const options: LoaderOptions = getOptions(this) || {};
	validateOptions(options);

	const sourceFileName = path.normalize(this.resourcePath);

	const callback = this.async();
	if (!callback) {
		return input;
	}

	const instance = setupInstance(
		this,
		options
	);

	(async () => {
		// ignore non-project files
		if (!isTsProjectSourceFile(instance.tscBuildConfig, sourceFileName)) {
			const ignoreProcess = () => {
				// console.log('*** ignore source [src =', sourceFileName, ']');
				callback(null, input, inputMap);
			};
			if (instance.watchStarted) {
				// if watching, there may be reload process by TypeScript
				await waitTime(40);
				if (!isTsProjectSourceFile(instance.tscBuildConfig, sourceFileName)) {
					ignoreProcess();
					return;
				}
			} else {
				ignoreProcess();
				return;
			}
		}

		// this.clearDependencies();
		// console.log('*** enter ts compilation [src =', sourceFileName, ']');

		let needInstallWatcher = false;
		if (instance.compilers.indexOf(this._compiler) < 0) {
			instance.compilers.push(this._compiler);
			if (this._compiler.options.watch) {
				needInstallWatcher = true;
			}
		}

		// run tsc (per instance)
		try {
			const tscBuildResult = await runTsc(instance, this._compiler);
			// console.log('*** after ts compilation [src =', sourceFileName, ']');
			if (needInstallWatcher) {
				installWatcher(this._compiler, tscBuildResult);
			}
			if (this._compiler && tscBuildResult.data.compilerOptions.declaration) {
				const onAfterCompile = (compilation: webpack.compilation.Compilation, callback: () => void) => {
					if (!(compilation.compiler as any).isChild()) {
						// emit declaration files for webpack
						emitDeclarationFile(this, compilation, tscBuildResult);
					}
					callback();
				};
				if (this._compiler.hooks) {
					this._compiler.hooks.afterCompile.tapAsync('ts-project-loader', onAfterCompile);
				} else {
					this._compiler.plugin('after-compile', onAfterCompile);
				}
			}

			const jsFileName = convertTsFileNameToJs(tscBuildResult, sourceFileName);
			// console.log('ts-project-loader: jsFileName = ', jsFileName);
			(this.fs as webpack.InputFileSystem).readFile(jsFileName, (err, jsSourceBuffer) => {
				if (err) {
					callback(err);
				} else {
					const jsSource = jsSourceBuffer.toString('utf8');
					// if source-map is emitted, use it
					if (jsSource && tscBuildResult.data.compilerOptions.sourceMap) {
						(this.fs as webpack.InputFileSystem).readFile(jsFileName + '.map', (err2, mapSource) => {
							if (err2) {
								logInfo(instance.handlers, err2.message, err2);
								callback(null, jsSource);
							} else {
								try {
									const { output, sourceMap } =
										makeSourceMap(jsSource, mapSource.toString('utf8'), input, sourceFileName, this);
									callback(null, output, sourceMap);
								} catch (e) {
									logInfo(instance.handlers, e && e.message || `${e}`, e);
									callback(null, jsSource);
								}
							}
						});
					} else {
						callback(null, jsSource);
					}
				}
			});
		} catch (error) {
			callback(error)
		}
	})();
}
