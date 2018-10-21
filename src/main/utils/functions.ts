
import * as path from 'path';

import TscBuildConfig from '../types/TscBuildConfig'

/** @internal */
export function isTsProjectSourceFile(tscBuildConfig: TscBuildConfig, fileName: string): boolean {
	if (Object.keys(tscBuildConfig.sourceDestMap).some((dest) => {
		return tscBuildConfig.sourceDestMap[dest] === fileName;
	})) {
		return true;
	}
	return tscBuildConfig.data.files.some((file) => path.normalize(file) === fileName);
}

/** @internal */
export function isChildPath(basePath: string, targetPath: string): boolean {
	const p = path.relative(basePath, targetPath).split(path.sep);
	return p.indexOf('..') < 0;
}

/** @internal */
export function getTsBasePath(tscBuildConfig: TscBuildConfig) {
	return (
		tscBuildConfig.data.compilerOptions.rootDir ||
		tscBuildConfig.commonSourceDirectory ||
		tscBuildConfig.configDirectory
	);
}

/** @internal */
export function convertTsFileNameToJs(tscBuildConfig: TscBuildConfig, tsFileName: string): string {
	const actualTsFileName = path.resolve(getTsBasePath(tscBuildConfig), tsFileName);
	const destFile = Object.keys(tscBuildConfig.sourceDestMap).filter((dest) => {
		return tscBuildConfig.sourceDestMap[dest] === actualTsFileName;
	})[0] as (string | undefined);
	if (destFile) {
		return destFile;
	}
	// thw following process may not be used, but remain it for fail-safe
	const relativeNameData = path.parse(actualTsFileName);
	delete relativeNameData.base;
	relativeNameData.ext = '.js';
	const wrappedFs = tscBuildConfig.wrappedFs;
	if (wrappedFs) {
		return wrappedFs.resolvePath(wrappedFs.joinPath(
			tscBuildConfig.data.compilerOptions.outDir!,
			path.format(relativeNameData)
		));
	} else {
		return path.join(tscBuildConfig.data.compilerOptions.outDir!, path.format(relativeNameData));
	}
}

/** @internal */
export function convertJsFileNameToTs(tscBuildConfig: TscBuildConfig, tempOutDir: string, jsFileName: string): string {
	const actualJsFile = tscBuildConfig.wrappedFs
		? tscBuildConfig.wrappedFs.resolvePath(jsFileName)
		: path.resolve(jsFileName);
	const srcFile = tscBuildConfig.sourceDestMap[actualJsFile] as (string | undefined);
	if (srcFile) {
		return srcFile;
	}
	// thw following process may not be used, but remain it for fail-safe
	const relativeNameData = path.parse(
		tscBuildConfig.wrappedFs
			? tscBuildConfig.wrappedFs.relativePath(tempOutDir, actualJsFile)
			: path.relative(tempOutDir, actualJsFile)
	);
	delete relativeNameData.base;
	relativeNameData.ext = '.ts';
	let s = path.normalize(path.join(getTsBasePath(tscBuildConfig), path.format(relativeNameData)));
	for (const file of tscBuildConfig.data.files) {
		if (/\.tsx$/.test(file) && file.startsWith(s)) {
			s = file;
			break;
		}
	}
	return s;
}
