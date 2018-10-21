
/// <reference types='node' />

import * as path from 'path';

import * as ts from 'typescript';
/// <reference path="./enhanced-resolve-node.d.ts" />
import node = require('enhanced-resolve/lib/node');

import TypeScriptError from '../errors/TypeScriptError';

import Handlers from '../types/Handlers';
import TscBuildConfig from '../types/TscBuildConfig';
import TscBuildResult from '../types/TscBuildResult';

import WrappedFs from '../fs/WrappedFs';

import {
	getTsBasePath
} from '../utils/functions';
import { handleError, logInfo, logVerbose } from '../utils/log';

import createResolverFactory from './createResolverFactory';

const createProgramForWatching = ts.createSemanticDiagnosticsBuilderProgram;

/** @internal */
export function findConfigFile(
	isDirectory: (name: string) => boolean,
	fileExists: (name: string) => boolean,
	fromPath?: string | null | undefined,
	tsconfig?: string | null | undefined
) {
	let searchPath = fromPath || './';
	let configName = 'tsconfig.json';
	if (tsconfig) {
		try {
			if (!/[\\\/]$/.test(tsconfig) && isDirectory(tsconfig)) {
				tsconfig += path.sep;
			}
		} catch (_e) { }
		const p = path.resolve(searchPath, tsconfig);
		if (/[\\\/]$/.test(tsconfig)) {
			searchPath = p + path.sep;
		} else {
			const { dir, base } = path.parse(p);
			if (dir) {
				searchPath = dir;
			}
			configName = base;
		}
	} else {
		try {
			if (!/[\\\/]$/.test(searchPath) && isDirectory(searchPath)) {
				searchPath += path.sep;
			}
		} catch (_e) { }
	}

	const configPath = ts.findConfigFile(
		searchPath.replace(/[\\\/]/g, '/'),
		(name) => { try { return fileExists(name); } catch (_e) { return false; } },
		configName
	);
	if (!configPath) {
		if (!tsconfig) {
			return void (0);
		}
		throw new Error(`Could not find a valid tsconfig.json from name '${tsconfig}'.`);
	}
	return configPath;
}

function validateCompilerOptions(compilerOptions: ts.CompilerOptions) {
	if (compilerOptions.outFile || compilerOptions.out) {
		throw new Error(`Bundling emitted files is not supported with using loader.`);
	}
}

/** @internal */
export function loadConfigFile(
	host: ts.ParseConfigHost,
	configPath: string | undefined,
	basePath: string,
	sourceMap: boolean,
	resolve: node.CreateResolverOptions,
	useTsModuleResolution?: boolean | undefined,
	tempBuildDir?: string | null | undefined,
	additionalCompilerOptions?: ts.CompilerOptions | undefined
): TscBuildConfig {
	let configDir;
	let parseResult;
	if (!configPath) {
		configDir = basePath;
		parseResult = ts.parseJsonConfigFileContent({}, host, configDir);
	} else {
		const readResult = ts.readConfigFile(configPath, host.readFile);
		if (readResult.error) {
			throw new TypeScriptError(readResult.error);
		}
		configDir = path.dirname(configPath);
		parseResult = ts.parseJsonConfigFileContent(readResult.config, host, configDir);
	}
	if (parseResult.errors && parseResult.errors.length > 0) {
		throw new TypeScriptError(parseResult.errors);
	}

	const extendedCompilerOptions = {
		...(additionalCompilerOptions || {}),
		outDir: ''
	};

	if (!configPath) {
		// 'rootDir' is used to compute TS --> JS file mappings
		parseResult.options.rootDir = path.resolve(basePath);
		// using 'ES2015' module style by default
		parseResult.options.module = ts.ModuleKind.ES2015;
	} else if (parseResult.options.rootDir) {
		parseResult.options.rootDir = path.resolve(configDir, parseResult.options.rootDir);
	}

	validateCompilerOptions(parseResult.options);
	if (additionalCompilerOptions) {
		validateCompilerOptions(additionalCompilerOptions);
		if (extendedCompilerOptions.rootDir) {
			extendedCompilerOptions.rootDir = path.resolve(configDir, extendedCompilerOptions.rootDir);
		}
	}

	let wrappedFs: WrappedFs | undefined;
	if (!tempBuildDir) {
		wrappedFs = new WrappedFs();
		extendedCompilerOptions.outDir = wrappedFs.rootPath;
	} else {
		extendedCompilerOptions.outDir = path.resolve(tempBuildDir);
	}
	extendedCompilerOptions.sourceMap = sourceMap;

	const resolver = createResolverFactory(resolve, useTsModuleResolution);
	return {
		configDirectory: configDir,
		data: {
			compilerOptions: {
				...parseResult.options,
				...extendedCompilerOptions
			},
			files: parseResult.fileNames
		},
		resolver,
		sourceDestMap: {},
		configFileName: configPath,
		extendedCompilerOptions,
		wrappedFs: wrappedFs
	};
}

function updateCommonSourceDirectory(program: ts.Program, config: TscBuildConfig, buildResult?: TscBuildResult) {
	// using internal method to compute actual base directory (when rootDir is not specified)
	config.commonSourceDirectory = ts.sys.resolvePath((program as any).getCommonSourceDirectory());
	if (buildResult) {
		buildResult.commonSourceDirectory = config.commonSourceDirectory;
	}
}

function hookWriteFileToGatherForSourceDestMap(host: ts.CompilerHost, sourceDestMap: { [destFile: string]: string }) {
	const origWriteFile: ts.WriteFileCallback =
		(host.writeFile && host.writeFile.bind(host)) || ts.sys.writeFile.bind(ts.sys);
	const realpath: (path: string) => string =
		(host.realpath && host.realpath.bind(host)) ||
		(ts.sys.realpath && ts.sys.realpath.bind(ts.sys)) ||
		((p: string) => path.resolve(p));
	host.writeFile = (fileName: string, data: string, writeByteOrderMark: boolean, onError: ((message: string) => void) | undefined, sourceFiles) => {
		let errorCalled = false;
		try {
			origWriteFile(fileName, data, writeByteOrderMark, (message) => {
				errorCalled = true;
				if (onError) {
					onError(message);
				}
			}, sourceFiles);
			if (!errorCalled && /\.jsx?$/.test(fileName)) {
				sourceDestMap[realpath(fileName)] = ts.sys.resolvePath(sourceFiles[0].fileName);
			}
		} catch (e) {
			onError && onError(e && (e.message || e.toString()) || 'Unexpected error');
		}
	};
}

/** @internal */
export function executeTsc(config: TscBuildConfig, _handlers: Handlers | undefined, locale?: string | undefined): TscBuildResult {
	const options: ts.CompilerOptions = { ...config.data.compilerOptions, locale };
	const host = ts.createCompilerHost(options);
	const resolutionCache = ts.createModuleResolutionCache(
		getTsBasePath(config), (file) => host.getCanonicalFileName(file)
	);
	const sourceDestMap = config.sourceDestMap;
	host.resolveModuleNames = config.resolver(
		options,
		host,
		resolutionCache
	);
	if (config.wrappedFs) {
		const fs = config.wrappedFs;
		host.writeFile = (fileName: string, data: string, writeByteOrderMark: boolean, onError: ((message: string) => void) | undefined, sourceFiles) => {
			try {
				fs.writeFile(fileName, data, writeByteOrderMark);
				if (/\.jsx?$/.test(fileName)) {
					sourceDestMap[fs.realpath(fileName)] = ts.sys.resolvePath(sourceFiles[0].fileName);
				}
			} catch (e) {
				onError && onError(e && (e.message || e.toString()) || 'Unexpected error');
			}
		};
		host.fileExists = (fileName) => fs.fileExists(fileName);
		host.readFile = (fileName) => fs.readFile(fileName);
		host.directoryExists = (directoryName) => fs.directoryExists(directoryName);
		host.getDirectories = (p) => fs.getDirectories(p);
		host.realpath = (p) => fs.realpath(p);
	} else {
		hookWriteFileToGatherForSourceDestMap(host, sourceDestMap);
	}
	const program = ts.createProgram(config.data.files, options, host);
	updateCommonSourceDirectory(program, config);

	const result = program.emit();
	if (result.diagnostics && result.diagnostics.length > 0) {
		throw new TypeScriptError(result.diagnostics);
	}
	return {
		...config,
		compilerHost: host
	};
}

function _calculateDeletedFiles(oldFiles: ReadonlyArray<string>, newFiles: ReadonlyArray<string>): string[] {
	return oldFiles.filter((file) => newFiles.indexOf(file) < 0);
}

/** @internal */
export function watchTsc<T>(
	startRebuild: () => T,
	finishBuild: (data: T | undefined, inWatch: boolean) => void,
	config: TscBuildConfig,
	handlers: Handlers | undefined,
	locale?: string | undefined
): TscBuildResult {
	let watchStarted = false;

	let buildResult: TscBuildResult | undefined;
	let startTimeOnFileChange: number | undefined;
	let resolveData: T | undefined;
	let oldSourceDestMap: { [destFile: string]: string } = {};

	const host = config.configFileName ?
		ts.createWatchCompilerHost(
			config.configFileName,
			{ ...(config.extendedCompilerOptions || {}), locale },
			config.wrappedFs || ts.sys,
			createProgramForWatching,
			reportDiagnostic,
			reportWatchStatusChanged
		) :
		ts.createWatchCompilerHost(
			config.data.files,
			{ ...config.data.compilerOptions, locale },
			config.wrappedFs || ts.sys,
			createProgramForWatching,
			reportDiagnostic,
			reportWatchStatusChanged
		);

	// Overrides host.createProgram because the 'host' parameter of createProgram
	// will differ from the result of createWatchCompilerHost
	(() => {
		const fs = config.wrappedFs;

		const origCreateProgram = host.createProgram;
		host.createProgram = function (this: typeof host, rootNames, options, compilerHost, oldProgram) {
			// adjust compiler options
			options.outDir = config.data.compilerOptions.outDir;
			options.locale = config.data.compilerOptions.locale;
			config.data.compilerOptions = { ...options };

			let getCanonicalFileName: (fileName: string) => string;
			if (compilerHost) {
				getCanonicalFileName = compilerHost.getCanonicalFileName;
			} else {
				getCanonicalFileName = (fileName) => path.resolve(fileName);
			}

			const resolutionCache = ts.createModuleResolutionCache(
				getTsBasePath(config), getCanonicalFileName
			);
			(host as any).resolveModuleNames = config.resolver(
				options,
				host,
				resolutionCache
			);
			if (compilerHost) {
				compilerHost.resolveModuleNames = host.resolveModuleNames;
			}

			// handle deleted files
			if (fs) {
				Promise.resolve(
					_calculateDeletedFiles(config.data.files, rootNames).map(
						(file) => {
							const dest = Object.keys(oldSourceDestMap).filter((destFile) => {
								return oldSourceDestMap[destFile] === file;
							})[0];
							return dest;
						}
					).filter((file) => file)
				).then((deletedFiles) => {
					fs.onFileDeleted(deletedFiles);
				});
			}
			config.data.files = rootNames.slice(0);

			if (compilerHost) {
				if (fs) {
					compilerHost.writeFile = (fileName: string, data: string, writeByteOrderMark: boolean, onError: ((message: string) => void) | undefined, sourceFiles: ReadonlyArray<ts.SourceFile>) => {
						// almost same implementation as local 'writeFile' function in 'createWatchProgram'
						try {
							const performance: any = (ts as any).performance;
							if (performance) {
								performance.mark('beforeIOWrite');
							}
							// 'ensureDirectoryExists' is not necessary because
							// WrappedFs's writeFile will automatically create directories
							fs.writeFile(fileName, data, writeByteOrderMark);
							if (/\.jsx?$/.test(fileName)) {
								config.sourceDestMap[fs.realpath(fileName)] = ts.sys.resolvePath(sourceFiles[0].fileName);
							}
							if (performance) {
								performance.mark('afterIOWrite');
								performance.measure('I/O Write', 'beforeIOWrite', 'afterIOWrite');
							}
						} catch (e) {
							onError && onError(e.message);
						}
					};
					compilerHost.fileExists = (fileName) => fs.fileExists(fileName);
					compilerHost.readFile = (fileName) => fs.readFile(fileName);
					compilerHost.directoryExists = (directoryName) => fs.directoryExists(directoryName);
					compilerHost.getDirectories = (p) => fs.getDirectories(p);
					compilerHost.realpath = (p) => fs.realpath(p);
				} else {
					hookWriteFileToGatherForSourceDestMap(compilerHost, config.sourceDestMap);
				}
			}
			const prog: ts.SemanticDiagnosticsBuilderProgram =
				origCreateProgram.call(this, rootNames, options, compilerHost, oldProgram);
			updateCommonSourceDirectory(prog.getProgram(), config, buildResult);
			return prog;
		};
	})();

	// To stop watching, monitor and store timers;
	// when stopping watching, reset all timers.
	const origClearTimeout = host.clearTimeout!;
	const origSetTimeout = host.setTimeout!;
	let timeoutIds: any[] = [];
	host.clearTimeout = (timeoutId) => {
		timeoutIds = timeoutIds.filter((id) => id !== timeoutId);
		origClearTimeout(timeoutId);
	};
	host.setTimeout = (callback, ms, ...args) => {
		const timeoutId = origSetTimeout((...args2) => {
			timeoutIds = timeoutIds.filter((id) => id !== timeoutId);
			callback(...args2);
		}, ms, ...args);
		timeoutIds.push(timeoutId);
		return timeoutId;
	};

	// `createWatchProgram` creates an initial program, watches files, and updates
	// the program over time.
	const watchProgram = ts.createWatchProgram(host as any);
	watchStarted = true;

	buildResult = {
		...config,
		compilerHost: host,
		watchInstance: {
			async stop() {
				// clear all timers to stop watching
				timeoutIds.splice(0).forEach((id) => {
					origClearTimeout(id);
				});
			},
			updateTsFiles(files: ReadonlyArray<string>) {
				if (config.configFileName) {
					return;
				}
				config.data.files = files.slice(0);
				watchProgram.updateRootFileNames(config.data.files);
			}
		}
	};
	return buildResult;

	function reportDiagnostic(diagnostic: ts.Diagnostic) {
		const err = new TypeScriptError(diagnostic);
		handleError(watchStarted, handlers, err);
	}

	function reportWatchStatusChanged(diagnostic: ts.Diagnostic) {
		switch (diagnostic.code) {
			case 6032:
				startTimeOnFileChange = Date.now();
				logInfo(handlers, 'TypeScript file change detected.');
				resolveData = startRebuild();
				oldSourceDestMap = config.sourceDestMap;
				buildResult!.sourceDestMap = config.sourceDestMap = {};
				break;
			case 6042:
				finishBuild(resolveData, watchStarted);
				if (watchStarted) {
					logInfo(handlers, `TypeScript compilation finished. (time = ${Date.now() - startTimeOnFileChange!} ms.)`);
				}
				break;
		}
		logVerbose(handlers, new TypeScriptError(diagnostic).message, diagnostic);
	}
}
