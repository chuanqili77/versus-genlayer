"""Minimal genlayer host stub for stand-in tests (guards, validation, tally, views).

This stub covers only the deterministic surface: contract registration,
storage, message sender, and UserError. Nondet calls raise if reached, so
stand-in tests prove guards fire before any consensus work.
"""
import sys
import types


class UserError(Exception):
    pass


class TreeMap(dict):
    pass


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _Nondet:
    @staticmethod
    def web_render(*args, **kwargs):
        raise AssertionError("nondet web.render must not be reached in stand-in tests")

    @staticmethod
    def exec_prompt(*args, **kwargs):
        raise AssertionError("nondet exec_prompt must not be reached in stand-in tests")


class _Web:
    render = _Nondet.web_render


class _NondetNS:
    web = _Web()
    exec_prompt = _Nondet.exec_prompt


class _VM:
    UserError = UserError


class _Message:
    sender_address = ""


class _GL:
    Contract = object
    public = _Public()
    vm = _VM()
    message = _Message()
    nondet = _NondetNS()


def install():
    mod = types.ModuleType("genlayer")
    mod.gl = _GL()
    mod.TreeMap = TreeMap
    sys.modules["genlayer"] = mod
    return mod
