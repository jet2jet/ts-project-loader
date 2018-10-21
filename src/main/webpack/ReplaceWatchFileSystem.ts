
import * as webpack from 'webpack';

import TscBuildResult from '../types/TscBuildResult';

import {
	convertJsFileNameToTs,
	convertTsFileNameToJs,
	isChildPath,
	isTsProjectSourceFile
} from '../utils/functions';

import WatchFileSystem from './WatchFileSystem';
import WatchFileSystemWatchCallback from './WatchFileSystemWatchCallback';

/** @internal */
export default class ReplaceWatchFileSystem implements WatchFileSystem {
	constructor(
		private wfs: WatchFileSystem,
		private tscBuildResult: TscBuildResult,
		private tempOutDir: string
	) {
	}

	public watch(
		files: string[],
		dirs: string[],
		missing: string[],
		startTime: number,
		options: webpack.ICompiler.WatchOptions,
		callback: WatchFileSystemWatchCallback,
		callbackUndelayed?: (file: string, mtime: number) => void
	) {
		files = files.map(
			(file) => isTsProjectSourceFile(this.tscBuildResult, file) ?
				convertTsFileNameToJs(this.tscBuildResult, file) :
				file
		);
		const wrappedCallback: WatchFileSystemWatchCallback =
			(err, filesModified, dirsModified, missingModified, fileTimestamps, dirTimestamps) => {
				callback(
					err,
					filesModified && filesModified.map((file) => {
						const wrappedFs = this.tscBuildResult.wrappedFs;
						if (wrappedFs) {
							if (!wrappedFs.isChildPath(this.tempOutDir, file)) {
								return file;
							}
						} else {
							if (!isChildPath(this.tempOutDir, file)) {
								return file;
							}
						}
						// back to .ts files
						const timestamp = fileTimestamps!.get(file);
						const tsFile = convertJsFileNameToTs(this.tscBuildResult, this.tempOutDir, file);
						if (typeof timestamp !== 'undefined') {
							// re-set timestamp map
							fileTimestamps!.delete(file);
							fileTimestamps!.set(tsFile, timestamp);
						}
						return tsFile;
					}),
					dirsModified,
					missingModified,
					fileTimestamps,
					dirTimestamps
				);
			};
		const wrappedFs = this.tscBuildResult.wrappedFs;
		if (wrappedFs) {
			return wrappedFs.watchFileSystem(
				this.wfs,
				files,
				dirs,
				missing,
				startTime,
				options,
				wrappedCallback,
				callbackUndelayed
			);
		} else {
			return this.wfs.watch(
				files,
				dirs,
				missing,
				startTime,
				options,
				wrappedCallback,
				callbackUndelayed
			);
		}
	}
}
