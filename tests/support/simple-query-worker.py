"""Use simple queries only for PGlite socket's error recovery compatibility test.
The production worker remains unchanged and uses psycopg's default protocol.
"""
import functools
import runpy
import psycopg
psycopg.connect = functools.partial(psycopg.connect, cursor_factory=psycopg.ClientCursor)
runpy.run_path('automation/worker.py', run_name='__main__')
