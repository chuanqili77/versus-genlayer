"""Direct-execution genlayer host stub.

Unlike the stand-in stub, this one actually runs the nondet round:
leader() executes, validator() checks it, and run_nondet_unsafe returns
the leader result on agreement or raises MAJORITY_DISAGREE. Web fetches
and LLM answers are driven by test-set tables, so judge() runs end to
end without a network or a model.
"""
import sys
import types


class UserError(Exception):
    pass


class TreeMap(dict):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _Web:
    pages = {}

    def render(self, url, mode="text"):
        if url not in self.pages:
            raise Exception(f"fetch failed for {url}")
        return self.pages[url]


class _Nondet:
    web = _Web()
    answers = []

    def exec_prompt(self, prompt, response_format="json"):
        if not self.answers:
            raise AssertionError("no canned exec_prompt answer left")
        return self.answers.pop(0)


class _VM:
    UserError = UserError
    Return = Return

    @staticmethod
    def run_nondet_unsafe(leader, validator):
        result = leader()
        if validator(Return(result)):
            return result
        raise UserError("MAJORITY_DISAGREE")


class _Message:
    sender_address = ""


class _GL:
    Contract = object
    public = _Public()
    vm = _VM()
    message = _Message()
    nondet = _Nondet()


def install():
    mod = types.ModuleType("genlayer")
    mod.gl = _GL()
    mod.TreeMap = TreeMap
    sys.modules["genlayer"] = mod
    return mod
