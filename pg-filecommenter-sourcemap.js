// pg-filecommenter-sourcemap.js
const path = require('path');
const fs = require('fs');
const { SourceMapConsumer } = require('source-map');

const sourceMapCache = new Map();

/**
 * Load source map for a given compiled JS file path.
 * Caches parsed maps for performance.
 */
async function loadSourceMapForFile(jsFilePath) {
  if (sourceMapCache.has(jsFilePath)) {
    return sourceMapCache.get(jsFilePath);
  }
  
  // Try to find source map file
  // Common pattern: look for jsFilePath + '.map'
  const mapPath = jsFilePath + '.map';
  
  if (!fs.existsSync(mapPath)) {
    sourceMapCache.set(jsFilePath, null);
    return null;
  }
  
  try {
    const rawMap = fs.readFileSync(mapPath, 'utf8');
    const parsedMap = await new SourceMapConsumer(rawMap);
    sourceMapCache.set(jsFilePath, parsedMap);
    return parsedMap;
  } catch (e) {
    // Failed to load/parse source map
    sourceMapCache.set(jsFilePath, null);
    return null;
  }
}

/**
 * Extract caller stack frame info - file, line, column
 */
function getCallerFrame() {
  const origPrepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, stack) => stack;
  
  const err = new Error();
  Error.captureStackTrace(err, getCallerFrame);
  const stack = err.stack;
  
  Error.prepareStackTrace = origPrepareStackTrace;

  for (const frame of stack) {
    const fileName = frame.getFileName();
    if (
      fileName &&
      !fileName.includes('node_modules') &&
      !fileName.endsWith('pg-filecommenter-sourcemap.js')
    ) {
      // Return relevant info
      return {
        fileName,
        line: frame.getLineNumber(),
        column: frame.getColumnNumber()
      };
    }
  }
  return null;
}

/**
 * Given compiled file info, resolve original position with source map
 * Falls back to compiled if no map available
 */
async function resolveOriginalPosition(frame) {
  const { fileName, line, column } = frame || {};
  if (!fileName || !line || !column) {
    return null;
  }
  
  const mapConsumer = await loadSourceMapForFile(fileName);
  if (!mapConsumer) {
    // No map exists, fallback to compiled file position
    return `${path.basename(fileName)}:${line}:${column}`;
  }
  
  const originalPos = mapConsumer.originalPositionFor({
    line,
    column
  });
  
  if (originalPos && originalPos.source) {
    // originalPos.source is relative to sourceRoot or source map
    return `${originalPos.source}:${originalPos.line}:${originalPos.column}`;
  }
  
  // Fallback if original pos missing fields
  return `${path.basename(fileName)}:${line}:${column}`;
}

/**
 * Append SQL comment with resolved caller info
 * @param {string|object} text - query text or QueryConfig
 * @param {any} values - query values
 * @returns {[string|object, any]} updated query and values
 */
async function addFileCommentToQuery(text, values) {
  const frame = getCallerFrame();
  const resolvedPosition = await resolveOriginalPosition(frame);
  
  // If unresolved, use unknown
  const commentContent = resolvedPosition ? `file=${resolvedPosition}` : 'file=unknown';
  const comment = `/* ${commentContent} */`;
  
  if (typeof text === 'string') {
    if (text.trim().endsWith(';')) {
      return [text.trim().slice(0, -1) + ' ' + comment + ';', values];
    }
    return [text + ' ' + comment, values];
  }
  
  if (typeof text === 'object' && text.text) {
    if (!text.text.includes(comment)) {
      text.text = text.text.trim().replace(/;?$/, '') + ' ' + comment + ';';
    }
    return [text, values];
  }
  
  return [text, values];
}

/**
 * Patch pg Pool instance to add file comment with sourcemap resolve
 * Async handling requires query wrapper
 * @param {import('pg').Pool} pool
 */
function patchPGPoolAsync(pool) {
  const origQuery = pool.query;

  // Because annotation is async, handle callback and promise forms:
  pool.query = function patchedQuery(text, values, callback) {
    // Handle function shift: query(text, callback);
    if (typeof values === 'function') {
      callback = values;
      values = undefined;
    }
    
    const promise = addFileCommentToQuery(text, values)
      .then(([newText, newValues]) =>
        origQuery.call(pool, newText, newValues)
      );
    
    if (callback) {
      promise.then(
        res => callback(null, res),
        err => callback(err)
      );
      return;
    }
    
    return promise;
  };
}

module.exports = { patchPGPoolAsync };
