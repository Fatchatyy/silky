import { withIsland } from '../lib/island';
import GuestRoute from '../components/GuestRoute';
import PasswordReset from '../screens/PasswordReset';

export default withIsland(() => (
  <GuestRoute>
    <PasswordReset />
  </GuestRoute>
));
