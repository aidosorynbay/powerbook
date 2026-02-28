from __future__ import annotations

from sqladmin import Admin, ModelView
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request

from app.core.security import verify_password
from app.db.session import get_engine, get_session_factory
from app.models.enums import SystemRole
from app.models.group import Group, GroupMember
from app.models.round import BookExchangePair, ReadingLog, Round, RoundParticipant, RoundResult
from app.models.user import User


class AdminAuth(AuthenticationBackend):
    async def login(self, request: Request) -> bool:
        form = await request.form()
        email = form.get("username", "")
        password = form.get("password", "")

        SessionLocal = get_session_factory()
        db = SessionLocal()
        try:
            from sqlalchemy import select

            user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
            if user is None or not user.is_active:
                return False
            if user.system_role not in {SystemRole.admin, SystemRole.superadmin}:
                return False
            if not verify_password(str(password), user.password_hash):
                return False
            request.session.update({"admin_user": str(user.id)})
            return True
        finally:
            db.close()

    async def logout(self, request: Request) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: Request) -> bool:
        return "admin_user" in request.session


# --- Model Views ---


class UserAdmin(ModelView, model=User):
    column_list = [User.id, User.email, User.display_name, User.telegram_id, User.gender, User.system_role, User.is_active, User.created_at]
    column_searchable_list = [User.email, User.display_name, User.telegram_id]
    column_sortable_list = [User.email, User.display_name, User.created_at]
    form_excluded_columns = [
        User.password_hash,
        User.group_memberships, User.round_participations, User.reading_logs,
        User.round_results, User.exchange_pairs_given, User.exchange_pairs_received,
    ]
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-users"


class GroupAdmin(ModelView, model=Group):
    column_list = [Group.id, Group.name, Group.slug, Group.owner_user_id, Group.created_at]
    column_searchable_list = [Group.name, Group.slug]
    name = "Group"
    name_plural = "Groups"
    icon = "fa-solid fa-people-group"


class GroupMemberAdmin(ModelView, model=GroupMember):
    column_list = [GroupMember.id, GroupMember.group_id, GroupMember.user_id, GroupMember.role, GroupMember.status, GroupMember.joined_at]
    name = "Group Member"
    name_plural = "Group Members"
    icon = "fa-solid fa-user-group"


class RoundAdmin(ModelView, model=Round):
    column_list = [Round.id, Round.group_id, Round.year, Round.month, Round.status, Round.registration_open_until_day, Round.started_at, Round.closed_at]
    column_sortable_list = [Round.year, Round.month, Round.status]
    name = "Round"
    name_plural = "Rounds"
    icon = "fa-solid fa-calendar"


class RoundParticipantAdmin(ModelView, model=RoundParticipant):
    column_list = [RoundParticipant.id, RoundParticipant.round_id, RoundParticipant.user_id, RoundParticipant.status, RoundParticipant.joined_at]
    name = "Participant"
    name_plural = "Participants"
    icon = "fa-solid fa-user-check"


class ReadingLogAdmin(ModelView, model=ReadingLog):
    column_list = [ReadingLog.id, ReadingLog.round_id, ReadingLog.user_id, ReadingLog.date, ReadingLog.minutes, ReadingLog.score, ReadingLog.book_finished, ReadingLog.comment]
    column_sortable_list = [ReadingLog.date, ReadingLog.minutes, ReadingLog.score]
    name = "Reading Log"
    name_plural = "Reading Logs"
    icon = "fa-solid fa-book"


class RoundResultAdmin(ModelView, model=RoundResult):
    column_list = [RoundResult.id, RoundResult.round_id, RoundResult.user_id, RoundResult.total_score, RoundResult.rank, RoundResult.group]
    column_sortable_list = [RoundResult.rank, RoundResult.total_score]
    name = "Round Result"
    name_plural = "Round Results"
    icon = "fa-solid fa-trophy"


class BookExchangePairAdmin(ModelView, model=BookExchangePair):
    column_list = [BookExchangePair.id, BookExchangePair.round_id, BookExchangePair.giver_user_id, BookExchangePair.receiver_user_id, BookExchangePair.giver_marked_given_at, BookExchangePair.receiver_marked_received_at]
    name = "Book Exchange"
    name_plural = "Book Exchanges"
    icon = "fa-solid fa-book-open"


def setup_admin(app):
    auth_backend = AdminAuth(secret_key="sqladmin-powerbook-secret")
    admin = Admin(app, get_engine(), authentication_backend=auth_backend)
    admin.add_view(UserAdmin)
    admin.add_view(GroupAdmin)
    admin.add_view(GroupMemberAdmin)
    admin.add_view(RoundAdmin)
    admin.add_view(RoundParticipantAdmin)
    admin.add_view(ReadingLogAdmin)
    admin.add_view(RoundResultAdmin)
    admin.add_view(BookExchangePairAdmin)
    return admin
