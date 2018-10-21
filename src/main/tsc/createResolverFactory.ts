import * as path from 'path';

import * as ts from 'typescript';

/// <reference path="./enhanced-resolve-node.d.ts" />
import node = require('enhanced-resolve/lib/node');

import ResolverFactory from '../types/ResolverFactory';

function resolveModuleName(
	scriptPattern: RegExp,
	compilerOptions: ts.CompilerOptions,
	resolver: node.ResolveSyncFunction,
	host: ts.ModuleResolutionHost,
	resolutionCache: ts.ModuleResolutionCache,
	moduleName: string,
	containingFile: string
): ts.ResolvedModule | undefined {
	let result: ts.ResolvedModule | undefined;

	try {
		const resolvedName = resolver(path.normalize(path.dirname(containingFile)), moduleName);
		if (resolvedName.match(scriptPattern)) {
			result = {
				resolvedFileName: resolvedName
			};
		}
	} catch (_e) { }

	const resolvedByTs = ts.resolveModuleName(moduleName, containingFile, compilerOptions, host, resolutionCache);
	if (resolvedByTs.resolvedModule) {
		// use resolved module from TypeScript if one of followings are true:
		// - enhanced-resolve cannot resolve
		// - resolved module is same
		// - enhanced-resolve resolved '.js' file and TypeScript resolved '.d.ts' file (using type declaration file)
		if (!result ||
			result.resolvedFileName === resolvedByTs.resolvedModule.resolvedFileName ||
			(/\.js$/i.test(result.resolvedFileName) && /\.d\.ts$/i.test(resolvedByTs.resolvedModule.resolvedFileName))
		) {
			result = resolvedByTs.resolvedModule;
		}
	}
	return result;
}

export default function createResolverFactory(
	resolve: node.CreateResolverOptions,
	useTsModuleResolution?: boolean | undefined
): ResolverFactory {
	if (useTsModuleResolution) {
		// simply uses ts.resolveModuleName
		return (compilerOptions, host, resolutionCache) => {
			return (moduleNames, containingFile) => {
				return moduleNames.map((moduleName) => ts.resolveModuleName(
					moduleName, containingFile, compilerOptions, host, resolutionCache
				).resolvedModule);
			};
		};
	} else {
		// uses enhanced-resolve
		return (compilerOptions, host, resolutionCache) => {
			const resolveSync = node.create.sync(resolve);
			const scriptPattern = compilerOptions.allowJs ? /\.jsx$|\.tsx$/ : /\.tsx$/;

			return (moduleNames, containingFile) => {
				return moduleNames.map((moduleName) => resolveModuleName(
					scriptPattern,
					compilerOptions,
					resolveSync,
					host,
					resolutionCache,
					moduleName,
					containingFile
				));
			};
		};
	}
}
